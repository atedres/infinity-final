"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, Users, MessageCircle, Heart, Share2, PlusCircle, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, getDocs, serverTimestamp, query, orderBy, where, doc, setDoc, deleteDoc, getDoc, updateDoc, increment } from 'firebase/firestore';

// Types
interface Post {
    id: string;
    authorId: string;
    authorName: string;
    authorHandle: string;
    authorAvatar: string;
    content: string;
    likes: number;
    comments: number;
    createdAt: any;
}

interface Room {
    id: string;
    creatorName: string;
    title: string;
    participants: number;
    isPublic: boolean;
}

export default function SoundSpherePage() {
    const { toast } = useToast();
    const [user, setUser] = useState<User | null>(null);

    // Feed State
    const [posts, setPosts] = useState<Post[]>([]);
    const [newPostContent, setNewPostContent] = useState('');
    const [followingIds, setFollowingIds] = useState<string[]>([]);

    // Rooms State
    const [rooms, setRooms] = useState<Room[]>([]);
    const [isRoomDialogOpen, setIsRoomDialogOpen] = useState(false);
    const [roomTitle, setRoomTitle] = useState('');
    const [roomDescription, setRoomDescription] = useState('');
    const [isPublicRoom, setIsPublicRoom] = useState("true");


    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, currentUser => {
            setUser(currentUser);
            if (currentUser) {
                fetchPosts();
                fetchRooms();
                fetchFollowing(currentUser.uid);
            } else {
                setPosts([]);
                setRooms([]);
                setFollowingIds([]);
            }
        });
        return () => unsubscribe();
    }, []);

    const fetchPosts = async () => {
        if (!db) return;
        const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const postsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
        setPosts(postsList);
    };

    const fetchRooms = async () => {
        if (!db) return;
        const q = query(collection(db, "audioRooms"), where("isPublic", "==", true), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const roomsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room));
        setRooms(roomsList);
    };

    const fetchFollowing = async (userId: string) => {
        if (!db) return;
        const q = collection(db, "users", userId, "following");
        const querySnapshot = await getDocs(q);
        const ids = querySnapshot.docs.map(doc => doc.id);
        setFollowingIds(ids);
    };

    const handleCreatePost = async () => {
        if (!db || !user || !newPostContent.trim()) {
            toast({ title: "Error", description: "You must be logged in and write something to post.", variant: "destructive" });
            return;
        }

        try {
            await addDoc(collection(db, "posts"), {
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous User',
                authorHandle: `@${user.email?.split('@')[0] || user.uid.substring(0, 5)}`,
                authorAvatar: user.photoURL || `https://placehold.co/40x40.png`,
                content: newPostContent,
                likes: 0,
                comments: 0,
                createdAt: serverTimestamp(),
            });
            toast({ title: "Success", description: "Your post is live!" });
            setNewPostContent('');
            fetchPosts();
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
            await addDoc(collection(db, "audioRooms"), {
                creatorId: user.uid,
                creatorName: user.displayName || 'Anonymous',
                title: roomTitle,
                description: roomDescription,
                isPublic: isPublicRoom === "true",
                participants: 0,
                createdAt: serverTimestamp(),
            });
            toast({ title: "Success", description: "Your room has been created." });
            setIsRoomDialogOpen(false);
            setRoomTitle('');
            setRoomDescription('');
            fetchRooms();
        } catch (error) {
            console.error("Error creating room:", error);
            toast({ title: "Error", description: "Failed to create room.", variant: "destructive" });
        }
    };

    const handleLikePost = async (postId: string) => {
        if (!db || !user) {
            toast({title: "Login Required", description: "You must be logged in to like a post.", variant: "destructive"});
            return;
        };
        const likeRef = doc(db, "posts", postId, "likes", user.uid);
        const postRef = doc(db, "posts", postId);
        
        try {
            const likeDoc = await getDoc(likeRef);
            if (likeDoc.exists()) {
                await deleteDoc(likeRef);
                await updateDoc(postRef, { likes: increment(-1) });
            } else {
                await setDoc(likeRef, { userId: user.uid });
                await updateDoc(postRef, { likes: increment(1) });
            }
            fetchPosts(); // In a real app, you might update local state for better UX
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


    return (
        <SubpageLayout title="Sound Sphere">
            <Tabs defaultValue="feed" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="feed">Post Feed</TabsTrigger>
                    <TabsTrigger value="rooms">Audio Rooms</TabsTrigger>
                </TabsList>
                <TabsContent value="feed" className="mt-6 space-y-6">
                    <Card>
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
                            <Button onClick={handleCreatePost} disabled={!user || !newPostContent.trim()}>Post to Sphere</Button>
                        </CardContent>
                    </Card>

                    <div className="space-y-4">
                        {posts.map((post) => (
                            <Card key={post.id}>
                                <CardContent className="p-6">
                                    <div className="flex items-start gap-4">
                                        <Link href={`/profile/${post.authorId}`}>
                                            <Avatar>
                                                <AvatarImage src={post.authorAvatar} data-ai-hint="person portrait"/>
                                                <AvatarFallback>{post.authorName.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                        </Link>
                                        <div className="w-full">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <Link href={`/profile/${post.authorId}`} className="font-semibold hover:underline">{post.authorName}</Link>
                                                    <span className="text-sm text-muted-foreground ml-2">{post.authorHandle}</span>
                                                </div>
                                                {user && user.uid !== post.authorId && (
                                                    <Button variant="outline" size="sm" onClick={() => handleFollow(post.authorId)}>
                                                        <UserPlus className="h-4 w-4 mr-2" />
                                                        {followingIds.includes(post.authorId) ? 'Following' : 'Follow'}
                                                    </Button>
                                                )}
                                            </div>
                                            <p className="my-2 text-foreground/90">{post.content}</p>
                                            <div className="flex items-center justify-between text-muted-foreground pt-2">
                                                <Button variant="ghost" size="sm" className="flex items-center gap-2">
                                                    <MessageCircle className="h-4 w-4" /> {post.comments}
                                                </Button>
                                                <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => handleLikePost(post.id)}>
                                                    <Heart className="h-4 w-4" /> {post.likes}
                                                </Button>
                                                <Button variant="ghost" size="sm" className="flex items-center gap-2">
                                                    <Share2 className="h-4 w-4" /> Share
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
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

                     <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                         {rooms.map((room) => (
                            <Card key={room.id}>
                                <CardContent className="p-6 space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="bg-primary/10 p-3 rounded-full">
                                            <Mic className="h-6 w-6 text-primary"/>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold">{room.title}</h4>
                                            <p className="text-sm text-muted-foreground">with {room.creatorName}</p>
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Users className="h-4 w-4" />
                                                <span>{room.participants} listening</span>
                                            </div>
                                        </div>
                                    </div>
                                    <Button className="w-full">Join Room</Button>
                                </CardContent>
                            </Card>
                         ))}
                     </div>
                </TabsContent>
            </Tabs>
        </SubpageLayout>
    );
}
