
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, Users, MessageCircle, Heart, Share2, PlusCircle, UserPlus, Send, Newspaper, Radio, MoreHorizontal, Edit, Trash2, Repeat, ImagePlus, X, Search, Loader2, CornerDownRight, CornerUpLeft } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { db, auth, storage } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, getDocs, serverTimestamp, query, orderBy, where, doc, setDoc, deleteDoc, getDoc, updateDoc, increment, Timestamp, onSnapshot, writeBatch } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';


// Types
interface OriginalPost {
    id: string;
    authorId: string;
    authorName: string;
    authorHandle: string;
    authorAvatar: string;
    content: string;
    createdAt: Timestamp;
    imageUrls?: string[];
}

interface Post {
    id: string;
    authorId: string;
    authorName: string;
    authorHandle: string;
    authorAvatar: string;
    content: string;
    likes: number;
    comments: number;
    createdAt: Timestamp;
    imageUrls?: string[];
    isRepost?: boolean;
    originalPost?: OriginalPost;
}

interface Room {
    id: string;
    creatorName: string;
    creatorAvatar?: string;
    title: string;
    description: string;
    participantsCount: number;
    isPublic: boolean;
}

interface Comment {
    id:string;
    authorId: string;
    authorName: string;
    authorAvatar: string;
    text: string;
    createdAt: Timestamp;
    parentId?: string;
    likes: number;
}

interface ProfileUser {
    id: string;
    firstName: string;
    lastName: string;
    photoURL?: string;
}


// Recursive component for rendering a comment and its replies
const CommentThread = ({ comment, post, allComments, onReplySubmit, onSetReplyingTo, replyingTo, user, depth = 0, renderSubtree = true, likedComments, onLikeComment, onDeleteComment, onUpdateComment }: {
    comment: Comment;
    post: Post;
    allComments: Comment[];
    onReplySubmit: (post: Post, parentCommentId: string, content: string) => void;
    onSetReplyingTo: (commentId: string | null) => void;
    replyingTo: string | null;
    user: User | null;
    depth?: number;
    renderSubtree?: boolean;
    likedComments: Set<string>;
    onLikeComment: (postId: string, commentId: string) => void;
    onDeleteComment: (postId: string, commentId: string) => void;
    onUpdateComment: (postId: string, commentId: string, newText: string) => void;
}) => {
    const [replyContent, setReplyContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(comment.text);
    const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
    
    // State for top-level comment expansion
    const [isExpanded, setIsExpanded] = useState(false);

    const replies = allComments.filter(c => c.parentId === comment.id);
    const isReplyingToThis = replyingTo === comment.id;
    const isAuthor = user?.uid === comment.authorId;
    const isLiked = likedComments.has(comment.id);
    const isEditable = comment.createdAt && (new Date().getTime() - comment.createdAt.toDate().getTime()) < 15 * 60 * 1000;
    
    // --- New Logic ---
    const getFullReplyCount = (startCommentId: string): number => {
        const children = allComments.filter(c => c.parentId === startCommentId);
        let count = children.length;
        children.forEach(child => count += getFullReplyCount(child.id));
        return count;
    };

    const totalReplyCount = depth === 0 ? getFullReplyCount(comment.id) : 0;
    const showToggleButtons = totalReplyCount > 1;

    const handleReplyFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onReplySubmit(post, comment.id, replyContent);
        setReplyContent('');
        onSetReplyingTo(null);
    };
    
    const handleSaveEdit = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdateComment(post.id, comment.id, editedContent);
        setIsEditing(false);
    };

    const handleDelete = () => {
        onDeleteComment(post.id, comment.id);
        setIsDeleteAlertOpen(false);
    };
    
    const renderReplies = () => {
        if (!renderSubtree) return null;

        if (depth === 0) { // I am a top-level comment, I control my own subtree
            const repliesToRender = isExpanded ? replies : replies.slice(0, 1);
            // In collapsed view, the first reply should NOT render its own children.
            // In expanded view, all children should render their own children.
            const passDownRenderSubtree = isExpanded; 
            return (
                <>
                    {repliesToRender.map(reply => (
                        <CommentThread 
                            key={reply.id} 
                            comment={reply}
                            post={post}
                            allComments={allComments}
                            onReplySubmit={onReplySubmit}
                            onSetReplyingTo={onSetReplyingTo}
                            replyingTo={replyingTo}
                            user={user}
                            depth={depth + 1}
                            renderSubtree={passDownRenderSubtree}
                            likedComments={likedComments}
                            onLikeComment={onLikeComment}
                            onDeleteComment={onDeleteComment}
                            onUpdateComment={onUpdateComment}
                        />
                    ))}
                    {showToggleButtons && !isExpanded && (
                        <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={() => setIsExpanded(true)}>
                            <CornerDownRight className="h-3 w-3 mr-1" /> View {totalReplyCount - 1} more replies
                        </Button>
                    )}
                    {showToggleButtons && isExpanded && (
                        <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={() => setIsExpanded(false)}>
                            <CornerUpLeft className="h-3 w-3 mr-1" /> View less
                        </Button>
                    )}
                </>
            )
        } else { // I am a nested reply, my parent told me to render my subtree
            return replies.map(reply => (
                <CommentThread 
                    key={reply.id} 
                    comment={reply}
                    post={post}
                    allComments={allComments}
                    onReplySubmit={onReplySubmit}
                    onSetReplyingTo={onSetReplyingTo}
                    replyingTo={replyingTo}
                    user={user}
                    depth={depth + 1}
                    renderSubtree={true} // If I'm rendered, my children should be too
                    likedComments={likedComments}
                    onLikeComment={onLikeComment}
                    onDeleteComment={onDeleteComment}
                    onUpdateComment={onUpdateComment}
                />
            ));
        }
    }


    return (
        <div key={comment.id}>
            <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Comment?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete this comment and all its replies.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <div className="flex items-start gap-3">
                <Link href={`/profile/${comment.authorId}`}>
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={comment.authorAvatar} />
                        <AvatarFallback>{comment.authorName.charAt(0)}</AvatarFallback>
                    </Avatar>
                </Link>
                <div className="bg-muted rounded-lg p-3 text-sm flex-1">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Link href={`/profile/${comment.authorId}`} className="font-semibold text-xs hover:underline">{comment.authorName}</Link>
                        </div>
                        {isAuthor && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                 <div>
                                                    <DropdownMenuItem disabled={!isEditable} onSelect={() => { setIsEditing(true); setEditedContent(comment.text); }}>
                                                        <Edit className="mr-2 h-4 w-4" /> Edit
                                                    </DropdownMenuItem>
                                                 </div>
                                            </TooltipTrigger>
                                             {!isEditable && (
                                                <TooltipContent side="left"><p>Can only edit within 15 mins.</p></TooltipContent>
                                            )}
                                        </Tooltip>
                                    </TooltipProvider>
                                    <DropdownMenuItem onSelect={() => setIsDeleteAlertOpen(true)} className="text-red-500 focus:text-red-500">
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                     {isEditing ? (
                        <form onSubmit={handleSaveEdit} className="mt-2 space-y-2">
                            <Textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)} rows={2} />
                            <div className="flex justify-end gap-2">
                                <Button type="button" size="sm" variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
                                <Button type="submit" size="sm" disabled={!editedContent.trim()}>Save</Button>
                            </div>
                        </form>
                    ) : (
                        <p className="mt-1 whitespace-pre-wrap">{comment.text}</p>
                    )}
                </div>
            </div>
            <div className="ml-11 flex items-center gap-4 pt-1 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" className="h-auto p-0 flex items-center gap-1 hover:text-red-500" onClick={() => onLikeComment(post.id, comment.id)} disabled={!user}>
                    <Heart fill={isLiked ? 'currentColor' : 'none'} className={cn('h-3 w-3', isLiked ? 'text-red-500' : 'text-muted-foreground')} /> 
                    {comment.likes > 0 && <span className={cn(isLiked && 'text-red-500 font-semibold')}>{comment.likes}</span>}
                </Button>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onSetReplyingTo(isReplyingToThis ? null : comment.id)} disabled={!user}>
                    Reply
                </Button>
                <span className="text-muted-foreground">{comment.createdAt ? formatDistanceToNow(comment.createdAt.toDate(), { addSuffix: true }) : ''}</span>
            </div>

            {isReplyingToThis && (
                 <div className="w-full mt-2 ml-11">
                    <form onSubmit={handleReplyFormSubmit} className="flex items-start gap-2">
                        <Textarea placeholder={`Replying to ${comment.authorName}...`} value={replyContent} onChange={(e) => setReplyContent(e.target.value)} className="flex-1" rows={1}/>
                        <Button type="submit" size="sm" disabled={!replyContent.trim()}>Send</Button>
                    </form>
                </div>
            )}
            
            <div className={cn("mt-3 space-y-3", depth < 2 ? "pl-4 border-l-2" : "")}>
                {renderReplies()}
            </div>
        </div>
    );
};


export default function SoundSphereClient() {
    const { toast } = useToast();
    const router = useRouter();
    const pathname = usePathname();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const searchParams = useSearchParams();
    const defaultTab = searchParams.get('tab') || 'feed';

    // Feed State
    const [posts, setPosts] = useState<Post[]>([]);
    const [newPostContent, setNewPostContent] = useState('');
    const [postImages, setPostImages] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [followingIds, setFollowingIds] = useState<string[]>([]);
    const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
    const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
    const [viewingCommentsFor, setViewingCommentsFor] = useState<string | null>(null);
    const [commentContent, setCommentContent] = useState('');
    const [postComments, setPostComments] = useState<Comment[]>([]);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    
    // Dialog states
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [postToDelete, setPostToDelete] = useState<Post | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [postToEdit, setPostToEdit] = useState<Post | null>(null);
    const [editedContent, setEditedContent] = useState('');
    const [isRepostDialogOpen, setIsRepostDialogOpen] = useState(false);
    const [postToRepost, setPostToRepost] = useState<Post | null>(null);
    const [repostComment, setRepostComment] = useState('');
    const [viewingImage, setViewingImage] = useState<string | null>(null);

    // Rooms State
    const [rooms, setRooms] = useState<Room[]>([]);
    const [isRoomDialogOpen, setIsRoomDialogOpen] = useState(false);
    const [roomTitle, setRoomTitle] = useState('');
    const [roomDescription, setRoomDescription] = useState('');
    const [isPublicRoom, setIsPublicRoom] = useState("true");
    
    // Floating Action Button State
    const createPostCardRef = useRef<HTMLDivElement>(null);
    const [isCreatePostFabVisible, setIsCreatePostFabVisible] = useState(false);
    const [isCreatePostDialogOpen, setIsCreatePostDialogOpen] = useState(false);
    const [newPostContentDialog, setNewPostContentDialog] = useState('');
    const [postImagesDialog, setPostImagesDialog] = useState<File[]>([]);
    const [imagePreviewsDialog, setImagePreviewsDialog] = useState<string[]>([]);
    const fileInputRefDialog = useRef<HTMLInputElement>(null);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<ProfileUser[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [user, setUser] = useState<User | null>(null);

    const fetchPosts = async (currentUserId?: string) => {
        if (!db) return;
        const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const postsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
        setPosts(postsList);
        
        if(currentUserId) {
            fetchLikesForPosts(postsList, currentUserId);
        }
    };

    const fetchLikesForPosts = async (posts: Post[], userId: string) => {
        if (!db) return;
        const newLikedPosts = new Set<string>();
        for (const post of posts) {
            const likeRef = doc(db, "posts", post.id, "likes", userId);
            const likeDoc = await getDoc(likeRef);
            if (likeDoc.exists()) {
                newLikedPosts.add(post.id);
            }
        }
        setLikedPosts(newLikedPosts);
    }

    const fetchFollowing = async (userId: string) => {
        if (!db) return;
        const q = collection(db, "users", userId, "following");
        const querySnapshot = await getDocs(q);
        const ids = querySnapshot.docs.map(doc => doc.id);
        setFollowingIds(ids);
    };

    useEffect(() => {
        const hash = window.location.hash;
        if (hash) {
            const elementId = hash.substring(1);
            const element = document.getElementById(elementId);
            if (element) {
                setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.classList.add('bg-accent/20', 'transition-colors', 'duration-1000', 'rounded-lg');
                    setTimeout(() => {
                        element.classList.remove('bg-accent/20', 'transition-colors', 'duration-1000', 'rounded-lg');
                    }, 2500);
                }, 500);
            }
        }

        if (!auth || !db) return;

        let roomsUnsubscribe: (() => void) | null = null;
        
        const authUnsubscribe = onAuthStateChanged(auth, currentUser => {
            setUser(currentUser);
            
            if (roomsUnsubscribe) {
                roomsUnsubscribe();
                roomsUnsubscribe = null;
            }

            if (currentUser) {
                fetchPosts(currentUser.uid);
                fetchFollowing(currentUser.uid);

                const q = query(collection(db, "audioRooms"), where("isPublic", "==", true), orderBy("createdAt", "desc"));
                roomsUnsubscribe = onSnapshot(q, (querySnapshot) => {
                    const roomsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room));
                    setRooms(roomsList);
                }, (error) => {
                     console.error("Error fetching rooms in real-time:", error);
                     toast({ title: "Error", description: "Could not load audio rooms.", variant: "destructive" });
                });

            } else {
                setPosts([]);
                setRooms([]);
                setFollowingIds([]);
                setLikedPosts(new Set());
                setLikedComments(new Set());
                setIsCreatePostFabVisible(false);
            }
        });

        // Intersection Observer for the floating button
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (auth.currentUser) {
                    setIsCreatePostFabVisible(!entry.isIntersecting);
                } else {
                    setIsCreatePostFabVisible(false);
                }
            },
            { rootMargin: "0px 0px -150px 0px", threshold: 0 }
        );

        if (createPostCardRef.current) {
            observer.observe(createPostCardRef.current);
        }

        return () => {
            authUnsubscribe();
            if (roomsUnsubscribe) {
                roomsUnsubscribe();
            }
            if (createPostCardRef.current) {
                observer.unobserve(createPostCardRef.current);
            }
        };
    }, [toast]);

    const handleSearch = async (queryTerm: string) => {
        if (!db || queryTerm.length < 2 || !user) {
            setSearchResults([]);
            return;
        }
        setIsSearching(true);
        try {
            const searchStr = queryTerm.charAt(0).toUpperCase() + queryTerm.slice(1);
            
            const usersRef = collection(db, "users");
            const firstNameQuery = query(usersRef, where("firstName", ">=", searchStr), where("firstName", "<=", searchStr + '\uf8ff'));
            const lastNameQuery = query(usersRef, where("lastName", ">=", searchStr), where("lastName", "<=", searchStr + '\uf8ff'));
            const idQuery = getDoc(doc(db, "users", queryTerm)).catch(() => null);

            const [firstNameSnap, lastNameSnap, idSnap] = await Promise.all([
                getDocs(firstNameQuery), 
                getDocs(lastNameQuery),
                idQuery
            ]);
            
            const resultsMap = new Map<string, ProfileUser>();
            
            const processSnapshot = (snap: any) => {
                snap.docs.forEach((doc: any) => {
                    if (doc.id !== user.uid && !resultsMap.has(doc.id)) {
                        const data = doc.data();
                        resultsMap.set(doc.id, {
                            id: doc.id,
                            firstName: data.firstName,
                            lastName: data.lastName,
                            photoURL: data.photoURL,
                        });
                    }
                });
            }

            processSnapshot(firstNameSnap);
            processSnapshot(lastNameSnap);

            if (idSnap && idSnap.exists() && idSnap.id !== user.uid && !resultsMap.has(idSnap.id)) {
                 const data = idSnap.data();
                 resultsMap.set(idSnap.id, {
                    id: idSnap.id,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    photoURL: data.photoURL,
                });
            }

            setSearchResults(Array.from(resultsMap.values()));
        } catch (error) {
            console.error("Error searching users:", error);
            toast({ title: "Search Error", description: "Could not perform search.", variant: "destructive" });
        } finally {
            setIsSearching(false);
        }
    };
    
    useEffect(() => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        const debounceTimer = setTimeout(() => {
            handleSearch(searchQuery);
        }, 300);

        return () => clearTimeout(debounceTimer);
    }, [searchQuery, user]);
    
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length + postImages.length > 5) {
            toast({ title: "Image Limit", description: "You can upload a maximum of 5 images.", variant: "destructive"});
            return;
        }
        setPostImages(prev => [...prev, ...files]);

        files.forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreviews(prev => [...prev, reader.result as string]);
            };
            reader.readAsDataURL(file);
        });
        e.target.value = ''; // Reset file input
    };

    const handleRemoveImage = (indexToRemove: number) => {
        setPostImages(prev => prev.filter((_, index) => index !== indexToRemove));
        setImagePreviews(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const handleCreatePost = async () => {
        if (!db || !user || !storage) {
            toast({ title: "Error", description: "You must be logged in to post.", variant: "destructive" });
            return;
        }
        if (!newPostContent.trim() && postImages.length === 0) {
            toast({ title: "Error", description: "You must write something or add an image to post.", variant: "destructive" });
            return;
        }

        toast({ title: "Posting...", description: "Your post is being uploaded." });

        let imageUrls: string[] = [];
        if (postImages.length > 0) {
            const uploadPromises = postImages.map(image => {
                const imageRef = storageRef(storage, `posts/${user.uid}/${Date.now()}_${image.name}`);
                return uploadBytes(imageRef, image).then(snapshot => getDownloadURL(snapshot.ref));
            });
            try {
                imageUrls = await Promise.all(uploadPromises);
            } catch (error) {
                console.error("Error uploading images:", error);
                toast({ title: "Image Upload Failed", description: "Could not upload your images.", variant: "destructive" });
                return;
            }
        }

        try {
            await addDoc(collection(db, "posts"), {
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous User',
                authorHandle: `@${user.email?.split('@')[0] || user.uid.substring(0, 5)}`,
                authorAvatar: user.photoURL || `https://placehold.co/40x40.png`,
                content: newPostContent,
                imageUrls: imageUrls,
                likes: 0,
                comments: 0,
                createdAt: serverTimestamp(),
            });
            toast({ title: "Success", description: "Your post is live!" });
            setNewPostContent('');
            setPostImages([]);
            setImagePreviews([]);
            fetchPosts(user.uid);
        } catch (error) {
            console.error("Error creating post:", error);
            toast({ title: "Error", description: "Failed to create post.", variant: "destructive" });
        }
    };
    
    const handleCreateRoom = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !user || !roomTitle.trim()) {
            toast({ title: "Error", description: "You must be logged in and provide a title.", variant: "destructive" });
            return;
        }
        try {
            const newRoomRef = await addDoc(collection(db, "audioRooms"), {
                creatorId: user.uid,
                creatorName: user.displayName || 'Anonymous',
                creatorAvatar: user.photoURL || '',
                title: roomTitle,
                description: roomDescription,
                isPublic: isPublicRoom === "true",
                participantsCount: 0,
                roles: {},
                createdAt: serverTimestamp(),
            });
            toast({ title: "Success", description: "Your room has been created." });
            setIsRoomDialogOpen(false);
            setRoomTitle('');
            setRoomDescription('');
            // No need to call fetchRooms, listener will pick it up
            router.push(`/sound-sphere/${newRoomRef.id}`);
        } catch (error) {
            console.error("Error creating room:", error);
            toast({ title: "Error", description: "Failed to create room.", variant: "destructive" });
        }
    };

    const handleLikePost = async (post: Post) => {
        if (!db || !user) {
            toast({title: "Login Required", description: "You must be logged in to like a post.", variant: "destructive"});
            return;
        };
        const likeRef = doc(db, "posts", post.id, "likes", user.uid);
        const postRef = doc(db, "posts", post.id);
        const newLikedPosts = new Set(likedPosts);
        
        try {
            const likeDoc = await getDoc(likeRef);
            if (likeDoc.exists()) {
                await deleteDoc(likeRef);
                await updateDoc(postRef, { likes: increment(-1) });
                newLikedPosts.delete(post.id);
            } else {
                await setDoc(likeRef, { userId: user.uid });
                await updateDoc(postRef, { likes: increment(1) });
                newLikedPosts.add(post.id);

                if (user.uid !== post.authorId) {
                    await addDoc(collection(db, "notifications"), {
                        recipientId: post.authorId,
                        actorId: user.uid,
                        actorName: user.displayName || 'Someone',
                        type: 'like',
                        entityId: post.id,
                        read: false,
                        createdAt: serverTimestamp(),
                    });
                }
            }
            setLikedPosts(newLikedPosts);
            fetchPosts(); // Refresh posts for updated counts
        } catch (error) {
            console.error("Error liking post:", error);
            toast({ title: "Error", description: "Could not update like status.", variant: "destructive" });
        }
    };
    
    const handleFollow = async (targetUserId: string) => {
        if (!db || !user || user.uid === targetUserId) {
             toast({title: "Login Required", description: "You must be logged in to follow users.", variant: "destructive"});
            return;
        }
        
        const followingRef = doc(db, "users", user.uid, "following", targetUserId);
        const followerRef = doc(db, "users", targetUserId, "followers", user.uid);

        try {
            if (followingIds.includes(targetUserId)) {
                // Unfollow
                await deleteDoc(followingRef);
                await deleteDoc(followerRef);
                setFollowingIds(prev => prev.filter(id => id !== targetUserId));
                toast({ title: "Unfollowed" });
            } else {
                // Follow
                await setDoc(followingRef, { since: serverTimestamp() });
                await setDoc(followerRef, { by: user.displayName || 'Anonymous', at: serverTimestamp() });
                setFollowingIds(prev => [...prev, targetUserId]);
                toast({ title: "Followed" });
            }
        } catch (error) {
            console.error("Error following user:", error);
            toast({ title: "Error", description: "Could not follow user.", variant: "destructive" });
        }
    };

    const toggleCommentsView = async (postId: string) => {
        if (!db) return;
        if (viewingCommentsFor === postId) {
            setViewingCommentsFor(null);
            setPostComments([]);
        } else {
            setViewingCommentsFor(postId);
            setReplyingTo(null);
            const commentsQuery = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
            const querySnapshot = await getDocs(commentsQuery);
            const commentsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Comment);
            setPostComments(commentsList);

            if (user) {
                const newLikedComments = new Set(likedComments);
                for (const comment of commentsList) {
                    const likeRef = doc(db, "posts", postId, "comments", comment.id, "likes", user.uid);
                    const likeDoc = await getDoc(likeRef);
                    if (likeDoc.exists()) {
                        newLikedComments.add(comment.id);
                    }
                }
                setLikedComments(newLikedComments);
            }
        }
    };

    const handleCommentSubmit = async (post: Post) => {
        if (!db || !user || !commentContent.trim()) {
            toast({ title: "Error", description: "Please write a comment to post.", variant: "destructive"});
            return;
        }

        try {
            const commentsColRef = collection(db, "posts", post.id, "comments");
            await addDoc(commentsColRef, {
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous',
                authorAvatar: user.photoURL || '',
                text: commentContent,
                likes: 0,
                createdAt: serverTimestamp(),
            });

            const postRef = doc(db, "posts", post.id);
            await updateDoc(postRef, { comments: increment(1) });
            
            if (user.uid !== post.authorId) {
                await addDoc(collection(db, "notifications"), {
                    recipientId: post.authorId,
                    actorId: user.uid,
                    actorName: user.displayName || 'Someone',
                    type: 'comment',
                    entityId: post.id,
                    read: false,
                    createdAt: serverTimestamp(),
                });
            }

            setCommentContent('');
            setReplyingTo(null);
            fetchPosts(user.uid);
            
            const commentsQuery = query(collection(db, "posts", post.id, "comments"), orderBy("createdAt", "asc"));
            const snapshot = await getDocs(commentsQuery);
            setPostComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Comment));
            
            toast({ title: "Comment posted!" });

        } catch (error) {
            console.error("Error posting comment:", error);
            toast({ title: "Error", description: "Could not post comment.", variant: "destructive"});
        }
    };

    const handleReplySubmit = async (post: Post, parentCommentId: string, content: string) => {
        if (!db || !user || !content.trim()) {
            toast({ title: "Error", description: "Please write a reply.", variant: "destructive"});
            return;
        }
        try {
            const commentsColRef = collection(db, "posts", post.id, "comments");
            await addDoc(commentsColRef, {
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous',
                authorAvatar: user.photoURL || '',
                text: content,
                parentId: parentCommentId,
                likes: 0,
                createdAt: serverTimestamp(),
            });

            const postRef = doc(db, "posts", post.id);
            await updateDoc(postRef, { comments: increment(1) });
            
            const parentComment = postComments.find(c => c.id === parentCommentId);
            if (parentComment && user.uid !== parentComment.authorId) {
                await addDoc(collection(db, "notifications"), {
                    recipientId: parentComment.authorId,
                    actorId: user.uid,
                    actorName: user.displayName || 'Someone',
                    type: 'comment',
                    entityId: post.id,
                    read: false,
                    createdAt: serverTimestamp(),
                });
            }

            setReplyingTo(null);
            
            const commentsQuery = query(collection(db, "posts", post.id, "comments"), orderBy("createdAt", "asc"));
            const snapshot = await getDocs(commentsQuery);
            setPostComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Comment));
            
            fetchPosts(user.uid);
            toast({ title: "Reply posted!" });
        } catch (error) {
            console.error("Error posting reply:", error);
            toast({ title: "Error", description: "Could not post reply.", variant: "destructive"});
        }
    };
    
    const handleDeletePost = async () => {
        if (!db || !user || !postToDelete) return;
        if (user.uid !== postToDelete.authorId) {
            toast({ title: "Error", description: "You can only delete your own posts.", variant: "destructive" });
            return;
        }

        try {
            await deleteDoc(doc(db, "posts", postToDelete.id));
            toast({ title: "Post Deleted", description: "Your post has been successfully removed." });
            fetchPosts(user.uid);
        } catch (error) {
            console.error("Error deleting post:", error);
            toast({ title: "Error", description: "Failed to delete post.", variant: "destructive" });
        } finally {
            setIsDeleteDialogOpen(false);
            setPostToDelete(null);
        }
    };
    
    const handleUpdatePost = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !user || !postToEdit || !editedContent.trim()) return;
        
        try {
            const postRef = doc(db, "posts", postToEdit.id);
            await updateDoc(postRef, { content: editedContent });
            toast({ title: "Post Updated", description: "Your changes have been saved." });
            fetchPosts(user.uid);
        } catch (error) {
            console.error("Error updating post:", error);
            toast({ title: "Error", description: "Failed to update post.", variant: "destructive" });
        } finally {
            setIsEditDialogOpen(false);
            setPostToEdit(null);
            setEditedContent('');
        }
    };

    const handleRepost = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !user || !postToRepost) return;

        try {
            await addDoc(collection(db, "posts"), {
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous User',
                authorHandle: `@${user.email?.split('@')[0] || user.uid.substring(0, 5)}`,
                authorAvatar: user.photoURL || `https://placehold.co/40x40.png`,
                content: repostComment, // User's new comment
                likes: 0,
                comments: 0,
                createdAt: serverTimestamp(),
                isRepost: true,
                originalPost: {
                    id: postToRepost.id,
                    authorId: postToRepost.authorId,
                    authorName: postToRepost.authorName,
                    authorHandle: postToRepost.authorHandle,
                    authorAvatar: postToRepost.authorAvatar,
                    content: postToRepost.content,
                    imageUrls: postToRepost.imageUrls || [],
                    createdAt: postToRepost.createdAt
                }
            });

            toast({ title: "Success", description: "Successfully reposted!" });
            fetchPosts(user.uid);
        } catch (error) {
            console.error("Error reposting:", error);
            toast({ title: "Error", description: "Failed to repost.", variant: "destructive" });
        } finally {
            setIsRepostDialogOpen(false);
            setPostToRepost(null);
            setRepostComment('');
        }
    };

    const handleLikeComment = async (postId: string, commentId: string) => {
        if (!db || !user) {
            toast({ title: "Login Required", description: "You must be logged in to like comments.", variant: "destructive" });
            return;
        }

        const likeRef = doc(db, "posts", postId, "comments", commentId, "likes", user.uid);
        const commentRef = doc(db, "posts", postId, "comments", commentId);
        const newLikedComments = new Set(likedComments);

        try {
            const likeDoc = await getDoc(likeRef);

            if (likeDoc.exists()) {
                await deleteDoc(likeRef);
                await updateDoc(commentRef, { likes: increment(-1) });
                newLikedComments.delete(commentId);
            } else {
                await setDoc(likeRef, { userId: user.uid, createdAt: serverTimestamp() });
                await updateDoc(commentRef, { likes: increment(1) });
                newLikedComments.add(commentId);

                const commentDoc = await getDoc(commentRef);
                if (commentDoc.exists() && user.uid !== commentDoc.data().authorId) {
                     await addDoc(collection(db, "notifications"), {
                        recipientId: commentDoc.data().authorId,
                        actorId: user.uid,
                        actorName: user.displayName || 'Someone',
                        type: 'like', // Could be a 'comment_like' type
                        entityId: postId, // Link back to the post
                        read: false,
                        createdAt: serverTimestamp(),
                    });
                }
            }
            setLikedComments(newLikedComments);

            // To update UI, refetch comments for the open post
            if (viewingCommentsFor === postId) {
                const commentsQuery = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
                const snapshot = await getDocs(commentsQuery);
                setPostComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Comment));
            }
        } catch (error) {
            console.error("Error liking comment:", error);
            toast({ title: "Error", description: "Could not update like.", variant: "destructive" });
        }
    };
    
    const handleDeleteComment = async (postId: string, commentId: string) => {
        if (!db || !user) return;
        const commentRef = doc(db, "posts", postId, "comments", commentId);
        
        try {
            const commentDoc = await getDoc(commentRef);
            if (!commentDoc.exists() || commentDoc.data().authorId !== user.uid) {
                toast({ title: "Error", description: "You can only delete your own comments.", variant: "destructive" });
                return;
            }

            const batch = writeBatch(db);
            let numToDelete = 1;

            const repliesQuery = query(collection(db, "posts", postId, "comments"), where("parentId", "==", commentId));
            const repliesSnapshot = await getDocs(repliesQuery);
            if (!repliesSnapshot.empty) {
                numToDelete += repliesSnapshot.size;
                repliesSnapshot.forEach(doc => batch.delete(doc.ref));
            }

            batch.delete(commentRef);

            const postRef = doc(db, "posts", postId);
            batch.update(postRef, { comments: increment(-numToDelete) });

            await batch.commit();
            toast({ title: "Comment Deleted" });
            
            // Update post comment count in local state
            setPosts(prevPosts => prevPosts.map(p => 
                p.id === postId ? { ...p, comments: p.comments - numToDelete } : p
            ));

            // Remove deleted comments from local comments state if section is open
            if (viewingCommentsFor === postId) {
                const deletedIds = new Set([commentId]);
                repliesSnapshot.forEach(doc => deletedIds.add(doc.id));
                setPostComments(prevComments => prevComments.filter(c => !deletedIds.has(c.id)));
            }
        } catch (error) {
            console.error("Error deleting comment:", error);
            toast({ title: "Error", description: "Could not delete comment.", variant: "destructive" });
        }
    };

    const handleUpdateComment = async (postId: string, commentId: string, newText: string) => {
        if (!db || !user) return;
        try {
            const commentRef = doc(db, "posts", postId, "comments", commentId);
            await updateDoc(commentRef, { text: newText });
            toast({ title: "Comment Updated" });

            if (viewingCommentsFor === postId) {
                const commentsQuery = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
                const snapshot = await getDocs(commentsQuery);
                setPostComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Comment));
            }
        } catch (error) {
            console.error("Error updating comment:", error);
            toast({ title: "Error", description: "Could not update comment.", variant: "destructive" });
        }
    };
    
    // Dialog image handlers
    const handleImageSelectDialog = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length + postImagesDialog.length > 5) {
            toast({ title: "Image Limit", description: "You can upload a maximum of 5 images.", variant: "destructive"});
            return;
        }
        setPostImagesDialog(prev => [...prev, ...files]);

        files.forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreviewsDialog(prev => [...prev, reader.result as string]);
            };
            reader.readAsDataURL(file);
        });
        e.target.value = '';
    };

    const handleRemoveImageDialog = (indexToRemove: number) => {
        setPostImagesDialog(prev => prev.filter((_, index) => index !== indexToRemove));
        setImagePreviewsDialog(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const handleCreatePostDialog = async () => {
        if (!db || !user || !storage) {
            toast({ title: "Error", description: "You must be logged in to post.", variant: "destructive" });
            return;
        }
        if (!newPostContentDialog.trim() && postImagesDialog.length === 0) {
            toast({ title: "Error", description: "You must write something or add an image.", variant: "destructive" });
            return;
        }

        toast({ title: "Posting...", description: "Your post is being uploaded." });

        let imageUrls: string[] = [];
        if (postImagesDialog.length > 0) {
            const uploadPromises = postImagesDialog.map(image => {
                const imageRef = storageRef(storage, `posts/${user.uid}/${Date.now()}_${image.name}`);
                return uploadBytes(imageRef, image).then(snapshot => getDownloadURL(snapshot.ref));
            });
            try {
                imageUrls = await Promise.all(uploadPromises);
            } catch (error) {
                console.error("Error uploading images:", error);
                toast({ title: "Image Upload Failed", description: "Could not upload your images.", variant: "destructive" });
                return;
            }
        }

        try {
            await addDoc(collection(db, "posts"), {
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous User',
                authorHandle: `@${user.email?.split('@')[0] || user.uid.substring(0, 5)}`,
                authorAvatar: user.photoURL || `https://placehold.co/40x40.png`,
                content: newPostContentDialog,
                imageUrls: imageUrls,
                likes: 0,
                comments: 0,
                createdAt: serverTimestamp(),
            });
            toast({ title: "Success", description: "Your post is live!" });
            setNewPostContentDialog('');
            setPostImagesDialog([]);
            setImagePreviewsDialog([]);
            setIsCreatePostDialogOpen(false);
            fetchPosts(user.uid);
        } catch (error) {
            console.error("Error creating post:", error);
            toast({ title: "Error", description: "Failed to create post.", variant: "destructive" });
        }
    };


    return (
        <>
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                    placeholder="Search for users by name or ID..."
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={!user}
                />
                 {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                )}
                 {searchResults.length > 0 && searchQuery.length > 0 && (
                    <Card className="absolute z-10 w-full mt-1 max-h-80 overflow-y-auto">
                        <CardContent className="p-2">
                            {searchResults.map(profile => (
                                <div key={profile.id} className="flex items-center justify-between p-2 hover:bg-muted rounded-md">
                                    <Link href={`/profile/${profile.id}`} className="flex items-center gap-3">
                                        <Avatar>
                                            <AvatarImage src={profile.photoURL} />
                                            <AvatarFallback>{profile.firstName?.[0]}{profile.lastName?.[0]}</AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="font-semibold">{profile.firstName} {profile.lastName}</p>
                                        </div>
                                    </Link>
                                    <Button size="sm" onClick={() => handleFollow(profile.id)}>
                                        <UserPlus className="h-4 w-4 mr-2" />
                                        {followingIds.includes(profile.id) ? 'Following' : 'Follow'}
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
            </div>

            <TooltipProvider>
                <Tabs defaultValue={defaultTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="feed"><Newspaper className="mr-2 h-4 w-4" />Post Feed</TabsTrigger>
                        <TabsTrigger value="rooms"><Radio className="mr-2 h-4 w-4" />Audio Rooms</TabsTrigger>
                    </TabsList>
                    <TabsContent value="feed" className="mt-6 space-y-6">
                        <Card ref={createPostCardRef}>
                            <CardHeader>
                                <h3 className="text-lg font-medium">Create a Post</h3>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Textarea 
                                    placeholder="What's on your mind? Share your challenges, wins, or questions..." 
                                    value={newPostContent}
                                    onChange={(e) => setNewPostContent(e.target.value)}
                                    disabled={!user}
                                />
                                {imagePreviews.length > 0 && (
                                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                        {imagePreviews.map((src, index) => (
                                            <div key={index} className="relative">
                                                <Image src={src} alt={`Preview ${index + 1}`} width={100} height={100} className="w-full h-full rounded-md object-cover aspect-square" />
                                                <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 rounded-full" onClick={() => handleRemoveImage(index)}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleImageSelect} />
                                <div className="flex items-center justify-between">
                                    <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={!user}>
                                        <ImagePlus className="h-5 w-5" />
                                        <span className="sr-only">Add images</span>
                                    </Button>
                                    <Button onClick={handleCreatePost} disabled={!user || (!newPostContent.trim() && postImages.length === 0)}>Post to Sphere</Button>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="space-y-4">
                            {posts.map((post) => {
                                const isPostOwner = user && user.uid === post.authorId;
                                const isEditable = post.createdAt && (new Date().getTime() - post.createdAt.toDate().getTime()) < 15 * 60 * 1000;
                                const topLevelComments = postComments.filter(comment => !comment.parentId);
                                
                                return (
                                <Card key={post.id} id={`post-${post.id}`}>
                                    <CardContent className="p-6">
                                        {post.isRepost && post.originalPost && (
                                            <div className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                                                <Repeat className="h-4 w-4"/>
                                                <span>Reposted by <Link href={`/profile/${post.authorId}`} className="font-semibold text-foreground hover:underline">{post.authorName}</Link></span>
                                            </div>
                                        )}
                                        <div className="flex items-start gap-4">
                                            <Link href={`/profile/${post.authorId}`}>
                                                <Avatar>
                                                    <AvatarImage src={post.authorAvatar} data-ai-hint="person portrait"/>
                                                    <AvatarFallback>{post.authorName.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                            </Link>
                                            <div className="w-full overflow-hidden">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <Link href={`/profile/${post.authorId}`} className="font-semibold hover:underline">{post.authorName}</Link>
                                                        <span className="text-sm text-muted-foreground ml-2">{post.authorHandle}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {user && !isPostOwner && !post.isRepost && (
                                                            <Button variant="outline" size="sm" onClick={() => handleFollow(post.authorId)}>
                                                                <UserPlus className="h-4 w-4 mr-2" />
                                                                {followingIds.includes(post.authorId) ? 'Following' : 'Follow'}
                                                            </Button>
                                                        )}
                                                        {isPostOwner && !post.isRepost && (
                                                              <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                                        <span className="sr-only">Open post menu</span>
                                                                        <MoreHorizontal className="h-4 w-4" />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end">
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <div>
                                                                                <DropdownMenuItem
                                                                                    disabled={!isEditable}
                                                                                    onSelect={() => {
                                                                                        setPostToEdit(post);
                                                                                        setEditedContent(post.content);
                                                                                        setIsEditDialogOpen(true);
                                                                                    }}
                                                                                >
                                                                                    <Edit className="mr-2 h-4 w-4" />
                                                                                    <span>Edit</span>
                                                                                </DropdownMenuItem>
                                                                            </div>
                                                                        </TooltipTrigger>
                                                                        {!isEditable && (
                                                                            <TooltipContent>
                                                                                <p>Can only edit within 15 minutes of posting.</p>
                                                                            </TooltipContent>
                                                                        )}
                                                                    </Tooltip>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem onSelect={() => { setPostToDelete(post); setIsDeleteDialogOpen(true); }} className="text-red-600 focus:text-red-600">
                                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                                        <span>Delete</span>
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        )}
                                                    </div>
                                                </div>
                                                
                                                <p className="my-2 text-foreground/90 whitespace-pre-wrap">{post.content}</p>

                                                {post.imageUrls && post.imageUrls.length > 0 && (
                                                    <div className={`mt-4 grid gap-1.5 ${post.imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                                        {post.imageUrls.map((url, index) => (
                                                            <div key={index} className="relative aspect-video w-full overflow-hidden rounded-lg border cursor-pointer" onClick={() => setViewingImage(url)}>
                                                                <Image src={url} alt={`Post image ${index+1}`} fill className="object-cover"/>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {post.isRepost && post.originalPost && (
                                                    <Card className="mt-4 border-2 border-border/80">
                                                        <CardContent className="p-4">
                                                             <div className="flex items-center gap-3">
                                                                <Link href={`/profile/${post.originalPost.authorId}`}>
                                                                    <Avatar className="h-8 w-8">
                                                                        <AvatarImage src={post.originalPost.authorAvatar} />
                                                                        <AvatarFallback>{post.originalPost.authorName.charAt(0)}</AvatarFallback>
                                                                    </Avatar>
                                                                </Link>
                                                                <div>
                                                                    <Link href={`/profile/${post.originalPost.authorId}`} className="font-semibold text-sm hover:underline">{post.originalPost.authorName}</Link>
                                                                    <span className="text-xs text-muted-foreground ml-2">{post.originalPost.authorHandle}</span>
                                                                </div>
                                                            </div>
                                                            <p className="mt-2 text-sm text-muted-foreground">{post.originalPost.content}</p>
                                                            {post.originalPost.imageUrls && post.originalPost.imageUrls.length > 0 && (
                                                                <div className={`mt-2 grid gap-1 ${post.originalPost.imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                                                    {post.originalPost.imageUrls.map((url, index) => (
                                                                        <div key={index} className="relative aspect-video w-full overflow-hidden rounded-md cursor-pointer" onClick={() => setViewingImage(url)}>
                                                                            <Image src={url} alt={`Original post image ${index + 1}`} fill className="object-cover" />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </CardContent>
                                                    </Card>
                                                )}

                                                <div className="flex items-center justify-between text-muted-foreground pt-2">
                                                    <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => toggleCommentsView(post.id)}>
                                                        <MessageCircle className="h-4 w-4" /> {post.comments}
                                                    </Button>
                                                    <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => handleLikePost(post)}>
                                                        <Heart fill={likedPosts.has(post.id) ? 'currentColor' : 'none'} className={`h-4 w-4 ${likedPosts.has(post.id) ? 'text-red-500' : ''}`} /> {post.likes}
                                                    </Button>
                                                    {!post.isRepost && (
                                                        <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => { setPostToRepost(post); setIsRepostDialogOpen(true); }}>
                                                            <Repeat className="h-4 w-4" /> Repost
                                                        </Button>
                                                    )}
                                                    <Button variant="ghost" size="sm" className="flex items-center gap-2">
                                                        <Share2 className="h-4 w-4" /> Share
                                                    </Button>
                                                </div>
                                                {viewingCommentsFor === post.id && (
                                                    <div className="mt-4 pt-4 border-t overflow-x-auto">
                                                        <form onSubmit={(e) => { e.preventDefault(); handleCommentSubmit(post); }} className="flex w-full items-start gap-2">
                                                            <Avatar className="h-9 w-9 mt-1">
                                                                <AvatarImage src={user?.photoURL || ''} />
                                                                <AvatarFallback>{user?.displayName?.charAt(0)}</AvatarFallback>
                                                            </Avatar>
                                                            <Textarea 
                                                                placeholder="Write a comment..."
                                                                value={commentContent}
                                                                onChange={(e) => setCommentContent(e.target.value)}
                                                                className="flex-1"
                                                            />
                                                            <Button type="submit" size="icon">
                                                                <Send className="h-4 w-4" />
                                                            </Button>
                                                        </form>
                                                        <div className="mt-4">
                                                            <div className="space-y-4">
                                                                {topLevelComments.map(comment => (
                                                                     <CommentThread
                                                                        key={comment.id}
                                                                        comment={comment}
                                                                        post={post}
                                                                        allComments={postComments}
                                                                        onReplySubmit={handleReplySubmit}
                                                                        onSetReplyingTo={setReplyingTo}
                                                                        replyingTo={replyingTo}
                                                                        user={user}
                                                                        likedComments={likedComments}
                                                                        onLikeComment={handleLikeComment}
                                                                        onDeleteComment={handleDeleteComment}
                                                                        onUpdateComment={handleUpdateComment}
                                                                    />
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )})}
                        </div>
                    </TabsContent>
                    <TabsContent value="rooms" className="mt-6 space-y-6">
                        <Dialog open={isRoomDialogOpen} onOpenChange={setIsRoomDialogOpen}>
                            <DialogTrigger asChild>
                                <Button className="w-full" disabled={!user}>
                                    <PlusCircle className="mr-2 h-4 w-4" /> Create New Room
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create a New Audio Room</DialogTitle>
                                    <DialogDescription>
                                        Start a conversation! Give your room a title and description.
                                    </DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleCreateRoom} className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="room-title">Title</Label>
                                        <Input id="room-title" value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} placeholder="e.g., Weekly Tech Roundup" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="room-desc">Description</Label>
                                        <Textarea id="room-desc" value={roomDescription} onChange={(e) => setRoomDescription(e.target.value)} placeholder="What will you be talking about?" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Privacy</Label>
                                        <RadioGroup defaultValue="true" value={isPublicRoom} onValueChange={setIsPublicRoom}>
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem value="true" id="public" />
                                                <Label htmlFor="public">Public</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem value="false" id="private" />
                                                <Label htmlFor="private">Private</Label>
                                            </div>
                                        </RadioGroup>
                                    </div>
                                    <DialogFooter>
                                        <Button type="submit" disabled={!roomTitle.trim()}>Create Room</Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>

                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {rooms.map((room) => (
                                <Link
                                    href={user ? `/sound-sphere/${room.id}` : '#'}
                                    key={room.id}
                                    className="block group"
                                    onClick={(e) => {
                                        if (!user) {
                                            e.preventDefault();
                                            toast({ title: "Login Required", description: "You must be logged in to join a room.", variant: "destructive" });
                                        }
                                    }}
                                >
                                    <Card className="hover:shadow-lg transition-shadow duration-300 h-full">
                                        <CardContent className="p-6">
                                            <div className="flex items-center gap-4 mb-3">
                                                <Avatar className="h-12 w-12">
                                                    <AvatarImage src={room.creatorAvatar} />
                                                    <AvatarFallback>{room.creatorName?.[0]}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 space-y-1 overflow-hidden">
                                                    <h4 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors truncate">{room.title}</h4>
                                                    <p className="text-sm text-muted-foreground break-words line-clamp-2">{room.description || `A conversation started by ${room.creatorName}`}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-muted-foreground pt-3 border-t">
                                                <div className="flex items-center gap-1.5">
                                                    <Users className="h-4 w-4" />
                                                    <span>{room.participantsCount} listening</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <Avatar className="h-5 w-5">
                                                        <AvatarImage src={room.creatorAvatar} />
                                                        <AvatarFallback>{room.creatorName?.[0]}</AvatarFallback>
                                                    </Avatar>
                                                    <span>{room.creatorName}</span>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                             ))}
                         </div>
                    </TabsContent>
                </Tabs>
            </TooltipProvider>

            {/* Dialog for Deleting Post */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete your post from our servers.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setPostToDelete(null)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeletePost} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Dialog for Editing Post */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Post</DialogTitle>
                        <DialogDescription>
                            Make changes to your post here. Click save when you're done.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleUpdatePost} className="space-y-4 py-4">
                        <Textarea
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            rows={5}
                        />
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
                            <Button type="submit">Save Changes</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

             {/* Dialog for Reposting */}
            <Dialog open={isRepostDialogOpen} onOpenChange={setIsRepostDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Repost</DialogTitle>
                        <DialogDescription>
                            Add a comment to share this post on your profile.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleRepost} className="space-y-4 py-4">
                        <Textarea
                            placeholder="Add a comment... (optional)"
                            value={repostComment}
                            onChange={(e) => setRepostComment(e.target.value)}
                            rows={3}
                        />
                        {postToRepost && (
                            <Card className="bg-muted/50">
                                <CardContent className="p-3">
                                    <div className="flex items-center gap-2">
                                        <Avatar className="h-6 w-6">
                                            <AvatarImage src={postToRepost.authorAvatar} />
                                            <AvatarFallback>{postToRepost.authorName.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <span className="text-sm font-semibold">{postToRepost.authorName}</span>
                                        <span className="text-xs text-muted-foreground">{postToRepost.authorHandle}</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-2">{postToRepost.content}</p>
                                </CardContent>
                            </Card>
                        )}
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setIsRepostDialogOpen(false)}>Cancel</Button>
                            <Button type="submit">Repost</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Dialog for Viewing Image */}
            <Dialog open={!!viewingImage} onOpenChange={() => setViewingImage(null)}>
                <DialogContent className="max-w-3xl p-0 bg-transparent border-none shadow-none">
                     <DialogHeader className="sr-only">
                        <DialogTitle>View Image</DialogTitle>
                        <DialogDescription>Full-screen view of the post image.</DialogDescription>
                    </DialogHeader>
                    <Image src={viewingImage || ''} alt="Full screen post image" width={1200} height={800} className="w-full h-auto object-contain rounded-lg"/>
                </DialogContent>
            </Dialog>
            
            {isCreatePostFabVisible && pathname === '/sound-sphere' && (
                 <Dialog open={isCreatePostDialogOpen} onOpenChange={setIsCreatePostDialogOpen}>
                    <DialogTrigger asChild>
                         <Button className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-40" size="icon">
                            <PlusCircle className="h-7 w-7"/>
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create a Post</DialogTitle>
                            <DialogDescription>
                                Share what's on your mind with the community.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <Textarea 
                                placeholder="Share your challenges, wins, or questions..." 
                                value={newPostContentDialog}
                                onChange={(e) => setNewPostContentDialog(e.target.value)}
                            />
                            {imagePreviewsDialog.length > 0 && (
                                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                    {imagePreviewsDialog.map((src, index) => (
                                        <div key={index} className="relative">
                                            <Image src={src} alt={`Preview ${index + 1}`} width={100} height={100} className="w-full h-full rounded-md object-cover aspect-square" />
                                            <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 rounded-full" onClick={() => handleRemoveImageDialog(index)}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-2">
                             <input type="file" ref={fileInputRefDialog} className="hidden" multiple accept="image/*" onChange={handleImageSelectDialog} />
                             <Button variant="ghost" size="icon" onClick={() => fileInputRefDialog.current?.click()}>
                                <ImagePlus className="h-5 w-5" />
                                <span className="sr-only">Add images</span>
                            </Button>
                            <Button onClick={handleCreatePostDialog} disabled={!user || (!newPostContentDialog.trim() && postImagesDialog.length === 0)}>Post</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}

