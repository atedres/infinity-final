
"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onAuthStateChanged, User, updateProfile } from 'firebase/auth';
import { writeBatch, deleteField, serverTimestamp, doc, getDoc, updateDoc, collection, addDoc, deleteDoc, setDoc, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import 'webrtc-adapter';
import Link from 'next/link';

import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db, auth, storage } from "@/lib/firebase";
import { Mic, MicOff, Hand, Check, X, Headphones, UserX, Link as LinkIcon, MoreVertical, Edit, ShieldCheck, TimerIcon, MessageSquareText, Send, Crown, Camera, PhoneOff, LogOut, MessageSquare, User as UserIcon, UserPlus, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReactCrop, centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useAudioRoom, type Participant, type SpeakRequest, type RoomChatMessage } from '@/components/layout/chat-launcher';


// Helper functions for image cropping
function canvasPreview(image: HTMLImageElement, canvas: HTMLCanvasElement, crop: PixelCrop) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context');
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const pixelRatio = window.devicePixelRatio;
  canvas.width = Math.floor(crop.width * scaleX * pixelRatio);
  canvas.height = Math.floor(crop.height * scaleY * pixelRatio);
  ctx.scale(pixelRatio, pixelRatio);
  ctx.imageSmoothingQuality = 'high';
  const cropX = crop.x * scaleX;
  const cropY = crop.y * scaleY;
  const centerX = image.naturalWidth / 2;
  const centerY = image.naturalHeight / 2;
  ctx.save();
  ctx.translate(-cropX, -cropY);
  ctx.translate(centerX, centerY);
  ctx.translate(-centerX, -centerY);
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, image.naturalWidth, image.naturalHeight);
  ctx.restore();
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Interface for private messages within the room context
interface P2PChatMessage {
    id: string;
    text: string;
    senderId: string;
    timestamp: any;
}

export default function AudioRoomPage() {
    const { toast } = useToast();
    const { roomId } = useParams() as { roomId: string };
    const { 
        joinRoom, promptToLeave, roomData, participants, speakingRequests,
        isMuted, myRole, canSpeak, hasRequested, speakerInvitation, elapsedTime,
        chatMessages, toggleMute, requestToSpeak, manageRequest, changeRole,
        acceptInvite, declineInvite, removeUser, selfPromoteToSpeaker,
        pinLink, unpinLink, updateRoomTitle, sendChatMessage, handlePictureUpload, endRoomForAll
    } = useAudioRoom();

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [followingIds, setFollowingIds] = useState<string[]>([]);

    // In-room profile editing refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);

    // Dialog & Sheet states
    const [selectedUser, setSelectedUser] = useState<Participant | null>(null);
    const [selectedUserProfileStats, setSelectedUserProfileStats] = useState<{posts: number, followers: number, following: number} | null>(null);
    const [isOwnProfileSheetOpen, setIsOwnProfileSheetOpen] = useState(false);
    const [ownProfileData, setOwnProfileData] = useState<Participant | null>(null);
    const [ownProfileDetails, setOwnProfileDetails] = useState<{bio?: string, role: string, firstName: string, lastName: string, emailHandle: string} | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editedFirstName, setEditedFirstName] = useState('');
    const [editedLastName, setEditedLastName] = useState('');
    const [editedRole, setEditedRole] = useState('');
    const [editedBio, setEditedBio] = useState('');
    const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
    const [imgSrc, setImgSrc] = useState('');
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const [isPinLinkDialogOpen, setIsPinLinkDialogOpen] = useState(false);
    const [linkToPinText, setLinkToPinText] = useState('');
    const [isTitleEditDialogOpen, setIsTitleEditDialogOpen] = useState(false);
    const [newRoomTitleText, setNewRoomTitleText] = useState('');
    const [isRoomChatOpen, setIsRoomChatOpen] = useState(false);
    const [newRoomChatMessage, setNewRoomChatMessage] = useState('');
    const [isEndRoomDialogOpen, setIsEndRoomDialogOpen] = useState(false);
    const roomChatMessagesEndRef = useRef<HTMLDivElement>(null);

    // Private Chat State
    const [isP2PChatOpen, setIsP2PChatOpen] = useState(false);
    const [p2pMessages, setP2PMessages] = useState<P2PChatMessage[]>([]);
    const [newP2PMessage, setNewP2PMessage] = useState('');
    const [p2pChatId, setP2PChatId] = useState<string | null>(null);
    const p2pChatUnsubscribe = useRef<() => void | null>(null);
    const p2pMessagesEndRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const fetchFollowing = async (userId: string) => {
            if (!db) return;
            const followingQuery = collection(db, "users", userId, "following");
            try {
                const snapshot = await getDocs(followingQuery);
                setFollowingIds(snapshot.docs.map(doc => doc.id));
            } catch (e) {
                console.error("Failed to fetch following list", e)
            }
        };

        const authUnsubscribe = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
            if (user) {
                fetchFollowing(user.uid);
            } else {
                setFollowingIds([]);
            }
        });
        return () => authUnsubscribe();
    }, []);
    
    useEffect(() => {
        if (roomId && currentUser) {
            joinRoom(roomId);
        }
    }, [roomId, currentUser, joinRoom]);
    
    useEffect(() => { 
        if (roomData) setNewRoomTitleText(roomData.title);
    }, [roomData]);

    useEffect(() => { roomChatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
    useEffect(() => { p2pMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [p2pMessages]);

    useEffect(() => {
        if (!selectedUser || !db) {
            setSelectedUserProfileStats(null);
            return;
        }

        const fetchProfileStats = async () => {
            try {
                const followersQuery = collection(db, "users", selectedUser.id, "followers");
                const followingQuery = collection(db, "users", selectedUser.id, "following");
                const postsQuery = query(collection(db, "posts"), where("authorId", "==", selectedUser.id));

                const [followersSnapshot, followingSnapshot, postsSnapshot] = await Promise.all([
                    getDocs(followersQuery),
                    getDocs(followingQuery),
                    getDocs(postsQuery),
                ]);

                setSelectedUserProfileStats({
                    followers: followersSnapshot.size,
                    following: followingSnapshot.size,
                    posts: postsSnapshot.size,
                });
            } catch (error) {
                console.error("Error fetching user stats:", error);
                setSelectedUserProfileStats(null);
            }
        };

        fetchProfileStats();
    }, [selectedUser]);

    // Create P2P Chat ID
    useEffect(() => {
        if (currentUser && selectedUser && currentUser.uid !== selectedUser.id) {
            const id = [currentUser.uid, selectedUser.id].sort().join('_');
            setP2PChatId(id);
        } else {
            setP2PChatId(null);
        }
    }, [currentUser, selectedUser]);
    
    // Listener for P2P chat messages
    useEffect(() => {
        if (!isP2PChatOpen || !p2pChatId || !db) {
            if (p2pChatUnsubscribe.current) {
                p2pChatUnsubscribe.current();
            }
            return;
        }

        const messagesRef = collection(db, "chats", p2pChatId, "messages");
        const q = query(messagesRef, orderBy("timestamp", "asc"));

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const fetchedMessages = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as P2PChatMessage[];
            setP2PMessages(fetchedMessages);
        });
        
        p2pChatUnsubscribe.current = unsubscribe;

        return () => {
            if(p2pChatUnsubscribe.current) {
                p2pChatUnsubscribe.current();
            }
        };
    }, [isP2PChatOpen, p2pChatId]);

    const handlePinLinkSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        pinLink(linkToPinText);
        setIsPinLinkDialogOpen(false);
        setLinkToPinText('');
    };
    const handleUpdateRoomTitleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        updateRoomTitle(newRoomTitleText);
        setIsTitleEditDialogOpen(false);
    };
    const handleSendRoomChatMessageSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        sendChatMessage(newRoomChatMessage);
        setNewRoomChatMessage('');
    };

    const handleSendP2PMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser || !p2pChatId || !newP2PMessage.trim() || !selectedUser) return;

        const messagesRef = collection(db, "chats", p2pChatId, "messages");
        
        await addDoc(messagesRef, {
            text: newP2PMessage,
            senderId: currentUser.uid,
            timestamp: serverTimestamp(),
        });
        
        const chatDocRef = doc(db, "chats", p2pChatId);
        await setDoc(chatDocRef, {
            participants: [currentUser.uid, selectedUser.id],
            participantNames: {
                [currentUser.uid]: currentUser.displayName,
                [selectedUser.id]: selectedUser.name
            },
            lastMessage: newP2PMessage,
            lastUpdate: serverTimestamp(),
        }, { merge: true });

        setNewP2PMessage('');
    };
    
    const handleFollowToggle = async (targetUser: Participant) => {
        if (!db || !currentUser || !targetUser || currentUser.uid === targetUser.id) {
            toast({ title: "Action not allowed", variant: "destructive" });
            return;
        }

        const followingRef = doc(db, "users", currentUser.uid, "following", targetUser.id);
        const followerRef = doc(db, "users", targetUser.id, "followers", currentUser.uid);

        try {
            const isCurrentlyFollowing = followingIds.includes(targetUser.id);
            if (isCurrentlyFollowing) {
                await deleteDoc(followingRef);
                await deleteDoc(followerRef);
                setFollowingIds(prev => prev.filter(id => id !== targetUser.id));
                toast({ title: "Unfollowed", description: `You are no longer following ${targetUser.name}.` });
            } else {
                await setDoc(followingRef, { since: serverTimestamp() });
                await setDoc(followerRef, { by: currentUser.displayName || 'Anonymous', at: serverTimestamp() });
                
                // Add notification
                if (currentUser.uid !== targetUser.id) {
                    await addDoc(collection(db, "notifications"), {
                        recipientId: targetUser.id,
                        actorId: currentUser.uid,
                        actorName: currentUser.displayName || 'Someone',
                        type: 'follow',
                        entityId: currentUser.uid,
                        read: false,
                        createdAt: serverTimestamp(),
                    });
                }
                
                setFollowingIds(prev => [...prev, targetUser.id]);
                toast({ title: "Followed", description: `You are now following ${targetUser.name}.` });
            }
        } catch (error) {
            console.error("Error following/unfollowing user:", error);
            toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
        }
    };


    const handleOpenOwnProfile = async () => {
        if (!db || !currentUser) return;
        const participant = participants.find(p => p.id === currentUser.uid);
        if (!participant) return;
        setOwnProfileData(participant);
        const userDocSnap = await getDoc(doc(db, "users", participant.id));
        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            const details = { bio: data.bio || '', role: data.role || '', firstName: data.firstName || '', lastName: data.lastName || '', emailHandle: `@${data.email?.split('@')[0] || ''}`};
            setOwnProfileDetails(details);
            setEditedFirstName(details.firstName); setEditedLastName(details.lastName); setEditedRole(details.role); setEditedBio(details.bio);
        }
        setIsOwnProfileSheetOpen(true);
    };
    
    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser) return;
        const newDisplayName = `${editedFirstName} ${editedLastName}`;
        const batch = writeBatch(db);
        batch.update(doc(db, "users", currentUser.uid), { firstName: editedFirstName, lastName: editedLastName, role: editedRole, bio: editedBio });
        if (roomData) {
          batch.update(doc(db, "audioRooms", roomData.id, "participants", currentUser.uid), { name: newDisplayName });
        }
        await batch.commit();
        await updateProfile(currentUser, { displayName: newDisplayName });
        setOwnProfileDetails(prev => prev ? { ...prev, firstName: editedFirstName, lastName: editedLastName, role: editedRole, bio: editedBio } : null);
        setOwnProfileData(prev => prev ? { ...prev, name: newDisplayName } : null);
        setIsEditDialogOpen(false);
        toast({ title: 'Profile Updated' });
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setCrop(undefined);
            const reader = new FileReader();
            reader.addEventListener('load', () => setImgSrc(reader.result?.toString() || ''));
            reader.readAsDataURL(e.target.files[0]);
            setIsCropDialogOpen(true);
            e.target.value = '';
        }
    };

    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        const { width, height } = e.currentTarget;
        const crop = centerCrop(makeAspectCrop({ unit: '%', width: 90 }, 1, width, height), width, height);
        setCrop(crop);
        setCompletedCrop(undefined);
    }
    
    const handleSaveCrop = async () => {
        const image = imgRef.current;
        const previewCanvas = previewCanvasRef.current;
        if (!image || !previewCanvas || !completedCrop) return;
        canvasPreview(image, previewCanvas, completedCrop);
        const blob = await toBlob(previewCanvas);
        if (!blob) return;
        const file = new File([blob], `profile_${currentUser?.uid || Date.now()}.png`, { type: 'image/png' });
        await handlePictureUpload(file);
        setOwnProfileData(prev => prev ? { ...prev, avatar: URL.createObjectURL(file) } : null);
        setIsCropDialogOpen(false);
    };

    if (!roomData || !currentUser) {
        return <SubpageLayout title="Sound Sphere Room" backHref="/sound-sphere?tab=rooms"><div className="text-center">Joining room...</div></SubpageLayout>;
    }

    const isModerator = myRole === 'creator' || myRole === 'moderator';
    
    const speakers = participants.filter(p => p.role === 'creator' || p.role === 'moderator' || p.role === 'speaker');
    const listeners = participants.filter(p => p.role === 'listener');
    
    const hasAdmins = participants.some(p => p.role === 'creator' || p.role === 'moderator');
    const hasSpeakers = participants.some(p => p.role === 'speaker');
    const isOpenStage = participants.length > 0 && !hasAdmins && !hasSpeakers;


    const renderParticipant = (p: Participant) => {
        const isUnmutedSpeaker = (p.role !== 'listener') && !p.isMuted;
        return (
            <button key={p.id} onClick={() => p.id === currentUser.uid ? handleOpenOwnProfile() : setSelectedUser(p)} className="relative flex flex-col items-center gap-2 cursor-pointer transition-transform hover:scale-105">
                <div className="relative">
                    <Avatar className={cn('h-16 w-16 sm:h-20 sm:w-20 border-4', isUnmutedSpeaker ? 'border-green-500' : 'border-transparent')}>
                        <AvatarImage src={p.avatar} data-ai-hint="person portrait"/>
                        <AvatarFallback>{p.name?.[0]}</AvatarFallback>
                    </Avatar>
                     {(p.isMuted || p.role === 'listener') && (
                        <div className="absolute top-0 right-0 bg-slate-700 rounded-full p-1 border-2 border-background"><MicOff className="h-3 w-3 text-slate-100" /></div>
                    )}
                     {(p.role === 'creator' || p.role === 'moderator') && (
                        <div className="absolute bottom-0 right-0 bg-primary rounded-full p-1 border-2 border-background">
                            {p.role === 'creator' ? <Crown className="h-3 w-3 text-primary-foreground" /> : <ShieldCheck className="h-3 w-3 text-primary-foreground" />}
                        </div>
                    )}
                </div>
                <p className="font-medium text-sm truncate w-full text-center">{p.name}</p>
            </button>
        );
    };
    
    const canManageSelectedUser = isModerator && selectedUser && selectedUser.id !== currentUser.uid;

    return (
        <SubpageLayout onBackClick={promptToLeave} title={roomData.title} backHref="/sound-sphere?tab=rooms" showTitle={false}>
            <AlertDialog open={!!speakerInvitation}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{speakerInvitation?.inviterName} has invited you to speak!</AlertDialogTitle>
                        <AlertDialogDescription>Would you like to join the speakers on stage?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={declineInvite}>Decline</AlertDialogCancel>
                        <AlertDialogAction onClick={acceptInvite}>Accept</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={isEndRoomDialogOpen} onOpenChange={setIsEndRoomDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure you want to end the room?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will end the session for everyone and the room will be deleted. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={endRoomForAll} className="bg-destructive hover:bg-destructive/90">End Room</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <div className="mx-auto max-w-4xl space-y-8 pb-28">
                <div className="text-left space-y-2">
                    <div className="flex items-center gap-2">
                        <h1 className="min-w-0 break-words text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl font-headline line-clamp-2">{roomData.title}</h1>
                        {isModerator && (
                             <Dialog open={isTitleEditDialogOpen} onOpenChange={setIsTitleEditDialogOpen}>
                                <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0"><Edit className="h-5 w-5" /></Button></DialogTrigger>
                                <DialogContent>
                                    <DialogHeader><DialogTitle>Edit Room Title</DialogTitle></DialogHeader>
                                    <form onSubmit={handleUpdateRoomTitleSubmit} className="space-y-4">
                                        <Input value={newRoomTitleText} onChange={(e) => setNewRoomTitleText(e.target.value)} />
                                        <DialogFooter><Button type="submit">Save Changes</Button></DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                        )}
                    </div>
                    <p className="text-lg text-muted-foreground">{roomData.description}</p>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <TimerIcon className="h-4 w-4" /><p className="text-sm font-mono">{elapsedTime}</p>
                    </div>
                </div>
                {roomData.pinnedLink && (
                     <Card>
                        <CardContent className="p-3 flex items-center justify-between">
                             <div className="flex items-center gap-3"><LinkIcon className="h-5 w-5 text-primary"/><a href={roomData.pinnedLink} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline truncate">{roomData.pinnedLink}</a></div>
                             {canSpeak && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent><DropdownMenuItem onClick={unpinLink}><X className="mr-2 h-4 w-4"/> Unpin Link</DropdownMenuItem></DropdownMenuContent>
                                </DropdownMenu>
                             )}
                        </CardContent>
                    </Card>
                )}
                 {isModerator && speakingRequests.length > 0 && (
                     <Card className="border-primary">
                        <CardHeader><CardTitle>Speaking Requests ({speakingRequests.length})</CardTitle><CardDescription>Accept or deny requests to speak from listeners.</CardDescription></CardHeader>
                        <CardContent className="space-y-4">
                            {speakingRequests.map(req => (
                                <div key={req.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                                    <div className="flex items-center gap-3"><Avatar className="h-10 w-10"><AvatarImage src={req.avatar} /><AvatarFallback>{req.name?.[0]}</AvatarFallback></Avatar><p className="font-medium">{req.name}</p></div>
                                    <div className="flex gap-2">
                                        <Button size="icon" variant="outline" className="bg-red-500/20 text-red-700 hover:bg-red-500/30" onClick={() => manageRequest(req.id, false)}><X className="h-4 w-4" /></Button>
                                        <Button size="icon" variant="outline" className="bg-green-500/20 text-green-700 hover:bg-green-500/30" onClick={() => manageRequest(req.id, true)}><Check className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
                <Dialog open={!!selectedUser} onOpenChange={(isOpen) => !isOpen && setSelectedUser(null)}>
                    <div className="space-y-6">
                        <Card>
                            <CardHeader className="flex flex-row items-center gap-2"><Mic className="h-5 w-5 text-primary" /><CardTitle>Speakers ({speakers.length})</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-y-4 gap-x-2">
                                {speakers.map(renderParticipant)}
                                {speakers.length === 0 && <p className="text-muted-foreground col-span-full text-center">No speakers yet.</p>}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center gap-2"><Headphones className="h-5 w-5 text-muted-foreground" /><CardTitle>Listeners ({listeners.length})</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-y-4 gap-x-2">
                               {listeners.map(renderParticipant)}
                                {listeners.length === 0 && <p className="text-muted-foreground col-span-full text-center">No listeners yet.</p>}
                            </CardContent>
                        </Card>
                    </div>
                     <DialogContent>
                        {selectedUser && (
                            <>
                                <DialogHeader className="items-center text-center pt-4">
                                     <Avatar className="h-24 w-24 border-2 border-primary"><AvatarImage src={selectedUser.avatar} alt={selectedUser.name} /><AvatarFallback className="text-3xl">{selectedUser.name?.[0]}</AvatarFallback></Avatar>
                                    <DialogTitle className="text-2xl pt-2">{selectedUser.name}</DialogTitle>
                                </DialogHeader>

                                {selectedUserProfileStats && (
                                    <div className="grid grid-cols-3 justify-around w-full pt-4 border-t divide-x">
                                        <div className="text-center px-2">
                                            <p className="font-bold text-xl">{selectedUserProfileStats.posts}</p>
                                            <p className="text-sm text-muted-foreground">Posts</p>
                                        </div>
                                        <div className="text-center px-2">
                                            <p className="font-bold text-xl">{selectedUserProfileStats.followers}</p>
                                            <p className="text-sm text-muted-foreground">Followers</p>
                                        </div>
                                        <div className="text-center px-2">
                                            <p className="font-bold text-xl">{selectedUserProfileStats.following}</p>
                                            <p className="text-sm text-muted-foreground">Following</p>
                                        </div>
                                    </div>
                                )}

                                {currentUser?.uid !== selectedUser.id && (
                                    <div className="grid grid-cols-2 gap-2 w-full pt-4 border-t">
                                        <Button asChild className="col-span-2">
                                            <Link href={`/profile/${selectedUser.id}`}>
                                                <UserIcon className="mr-2 h-4 w-4" /> View Profile
                                            </Link>
                                        </Button>
                                        <Button
                                            variant={followingIds.includes(selectedUser.id) ? "secondary" : "default"}
                                            onClick={() => handleFollowToggle(selectedUser)}
                                        >
                                            {followingIds.includes(selectedUser.id) ? <UserCheck className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                            {followingIds.includes(selectedUser.id) ? 'Following' : 'Follow'}
                                        </Button>
                                        <Sheet open={isP2PChatOpen} onOpenChange={setIsP2PChatOpen}>
                                            <SheetTrigger asChild>
                                                <Button variant="outline">
                                                    <MessageSquare className="mr-2 h-4 w-4" /> Message
                                                </Button>
                                            </SheetTrigger>
                                            <SheetContent className="flex flex-col">
                                                <SheetHeader>
                                                    <SheetTitle>Chat with {selectedUser.name}</SheetTitle>
                                                </SheetHeader>
                                                <div className="flex-1 flex flex-col overflow-y-auto">
                                                    <ScrollArea className="flex-1 pr-4 -mr-4">
                                                        <div className="space-y-4 py-4">
                                                        {p2pMessages.map(message => (
                                                            <div key={message.id} className={cn("flex w-max max-w-xs flex-col gap-1 rounded-lg px-3 py-2 text-sm",
                                                                message.senderId === currentUser?.uid ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                                                            )}>
                                                                {message.text}
                                                            </div>
                                                        ))}
                                                        <div ref={p2pMessagesEndRef} />
                                                        </div>
                                                    </ScrollArea>
                                                </div>
                                                <form onSubmit={handleSendP2PMessage} className="mt-auto flex gap-2 pt-4 border-t">
                                                    <Input value={newP2PMessage} onChange={(e) => setNewP2PMessage(e.target.value)} placeholder="Type a message..." autoComplete="off"/>
                                                    <Button type="submit" disabled={!newP2PMessage.trim()}>Send</Button>
                                                </form>
                                            </SheetContent>
                                        </Sheet>
                                    </div>
                                )}
                                
                                <div className="space-y-2 pt-4">
                                    {canManageSelectedUser && selectedUser.role !== 'creator' && <div className="border-t pt-4 space-y-2">
                                        <p className="text-sm font-medium text-center">Moderator Actions</p>
                                        <div className="flex flex-wrap justify-center gap-2">
                                            {selectedUser.role === 'listener' && <Button size="sm" onClick={() => { changeRole(selectedUser.id, 'speaker'); setSelectedUser(null); }}>Invite to Speak</Button>}
                                            {selectedUser.role === 'speaker' && (
                                                <>
                                                    <Button size="sm" onClick={() => { changeRole(selectedUser.id, 'moderator'); setSelectedUser(null); }}>Make Moderator</Button>
                                                    <Button size="sm" variant="outline" onClick={() => { changeRole(selectedUser.id, 'listener'); setSelectedUser(null); }}>Move to Listeners</Button>
                                                </>
                                            )}
                                            {selectedUser.role === 'moderator' && (
                                                <>
                                                    <Button size="sm" onClick={() => { changeRole(selectedUser.id, 'speaker'); setSelectedUser(null); }}>Demote to Speaker</Button>
                                                    <Button size="sm" variant="outline" onClick={() => { changeRole(selectedUser.id, 'listener'); setSelectedUser(null); }}>Move to Listeners</Button>
                                                </>
                                            )}
                                             <Button size="sm" variant="destructive" onClick={() => { removeUser(selectedUser.id); setSelectedUser(null); }}>
                                                <UserX className="mr-2 h-4 w-4" /> Ban from Room
                                            </Button>
                                        </div>
                                    </div>}
                                </div>
                            </>
                        )}
                    </DialogContent>
                </Dialog>
                <Dialog open={isPinLinkDialogOpen} onOpenChange={setIsPinLinkDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Pin a Link</DialogTitle><DialogDescription>Share a relevant link with everyone in the room. It will appear at the top.</DialogDescription></DialogHeader>
                        <form onSubmit={handlePinLinkSubmit} className="space-y-4"><div className="grid gap-4 py-4"><Input placeholder="https://example.com" value={linkToPinText} onChange={(e) => setLinkToPinText(e.target.value)}/></div><Button type="submit">Pin Link</Button></form>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="fixed bottom-0 left-0 right-0 z-10 border-t bg-background/80 p-4 backdrop-blur-sm">
                <div className="container mx-auto flex max-w-4xl items-center justify-between gap-2 sm:gap-4">
                    <Button variant="destructive" onClick={promptToLeave} className="px-3 sm:px-4">
                        <PhoneOff className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Leave</span>
                    </Button>
            
                    <div className="flex items-center gap-2">
                        {canSpeak ? (
                            <Button variant={isMuted ? 'secondary' : 'default'} onClick={toggleMute} size="icon" className="h-12 w-12 rounded-full">
                                {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                                <span className="sr-only">{isMuted ? 'Unmute' : 'Mute'}</span>
                            </Button>
                        ) : isOpenStage ? (
                            <Button onClick={selfPromoteToSpeaker} variant="outline" className="px-3 sm:px-4">
                                <Mic className="h-4 w-4 sm:mr-2" /> 
                                <span className="hidden sm:inline">Become a Speaker</span>
                                <span className="sm:hidden">Speak</span>
                            </Button>
                        ) : (
                            <Button onClick={requestToSpeak} disabled={hasRequested} variant="outline" className="px-3 sm:px-4">
                                <Hand className="h-4 w-4 sm:mr-2" />
                                <span className="hidden sm:inline">{hasRequested ? 'Request Sent' : 'Request to Speak'}</span>
                                <span className="sm:hidden">{hasRequested ? '...' : 'Speak'}</span>
                            </Button>
                        )}
                    </div>
            
                    <div className="flex items-center gap-2">
                        <Sheet open={isRoomChatOpen} onOpenChange={setIsRoomChatOpen}>
                            <SheetTrigger asChild>
                                <Button variant="outline" size="icon" className="h-10 w-10">
                                    <MessageSquareText className="h-5 w-5" />
                                    <span className="sr-only">Open Chat</span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent className="flex flex-col">
                                <SheetHeader><SheetTitle>Live Chat</SheetTitle></SheetHeader>
                                <ScrollArea className="flex-1 -mx-6 px-6 mt-4">
                                    <div className="space-y-4 pr-1 pb-4">
                                        {chatMessages.map(msg => (
                                            <div key={msg.id} className="flex items-start gap-3">
                                                 <Avatar className="h-8 w-8"><AvatarImage src={msg.senderAvatar} /><AvatarFallback>{msg.senderName?.[0]}</AvatarFallback></Avatar>
                                                <div><p className="text-sm font-semibold">{msg.senderName}</p><p className="text-sm bg-muted p-2 rounded-lg mt-1">{msg.text}</p></div>
                                            </div>
                                        ))}
                                        <div ref={roomChatMessagesEndRef} />
                                    </div>
                                </ScrollArea>
                                <form onSubmit={handleSendRoomChatMessageSubmit} className="flex items-center gap-2 pt-4 border-t">
                                    <Textarea value={newRoomChatMessage} onChange={(e) => setNewRoomChatMessage(e.target.value)} placeholder="Send a message..." rows={1} className="min-h-0"/><Button type="submit" size="icon" disabled={!newRoomChatMessage.trim()}><Send className="h-4 w-4"/></Button>
                                </form>
                            </SheetContent>
                        </Sheet>
        
                        {isModerator && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="icon" className="h-10 w-10">
                                        <MoreVertical className="h-5 w-5" />
                                        <span className="sr-only">More actions</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => setIsPinLinkDialogOpen(true)}>
                                        <LinkIcon className="mr-2 h-4 w-4" />
                                        <span>Pin Link</span>
                                    </DropdownMenuItem>
                                    {roomData.pinnedLink && (
                                        <DropdownMenuItem onSelect={unpinLink}>
                                            <X className="mr-2 h-4 w-4" />
                                            <span>Unpin Link</span>
                                        </DropdownMenuItem>
                                    )}
                                    {myRole === 'creator' && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onSelect={() => setIsEndRoomDialogOpen(true)} className="focus:bg-destructive/80 focus:text-destructive-foreground text-destructive">
                                                <LogOut className="mr-2 h-4 w-4" />
                                                <span>End Room for All</span>
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                </div>
            </div>

            <Dialog open={isCropDialogOpen} onOpenChange={setIsCropDialogOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Crop your new picture</DialogTitle><DialogDescription>Adjust the image to fit perfectly.</DialogDescription></DialogHeader>
                    {imgSrc && (<div className="flex justify-center"><ReactCrop crop={crop} onChange={(_, percentCrop) => setCrop(percentCrop)} onComplete={(c) => setCompletedCrop(c)} aspect={1} minWidth={100} minHeight={100} circularCrop><img ref={imgRef} alt="Crop me" src={imgSrc} style={{ maxHeight: '70vh' }} onLoad={onImageLoad} /></ReactCrop></div>)}
                    <DialogFooter><Button variant="outline" onClick={() => setIsCropDialogOpen(false)}>Cancel</Button><Button onClick={handleSaveCrop} disabled={!completedCrop}>Save Picture</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {completedCrop && (<canvas ref={previewCanvasRef} style={{ display: 'none', objectFit: 'contain', width: completedCrop.width, height: completedCrop.height, }}/>)}
            
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Edit Your Profile</DialogTitle><DialogDescription>Make changes to your profile here. Click save when you're done.</DialogDescription></DialogHeader>
                    <form onSubmit={handleProfileUpdate} className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label htmlFor="firstName">First Name</Label><Input id="firstName" value={editedFirstName} onChange={(e) => setEditedFirstName(e.target.value)} /></div>
                            <div className="space-y-2"><Label htmlFor="lastName">Last Name</Label><Input id="lastName" value={editedLastName} onChange={(e) => setEditedLastName(e.target.value)} /></div>
                        </div>
                        <div className="space-y-2"><Label htmlFor="role">Role</Label><Input id="role" value={editedRole} onChange={(e) => setEditedRole(e.target.value)} /></div>
                        <div className="space-y-2"><Label htmlFor="bio">Bio</Label><Textarea id="bio" placeholder="Tell us a bit about yourself..." value={editedBio} onChange={(e) => setEditedBio(e.target.value)} /></div>
                        <DialogFooter><Button type="submit">Save Changes</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            
            <Sheet open={isOwnProfileSheetOpen} onOpenChange={setIsOwnProfileSheetOpen}>
                <SheetContent>
                    {ownProfileData && ownProfileDetails && (
                        <>
                            <SheetHeader className="items-center text-center pt-4">
                                <div className="relative">
                                    <Avatar className="h-24 w-24 border-2 border-primary"><AvatarImage src={ownProfileData.avatar} alt={ownProfileData.name} /><AvatarFallback className="text-3xl">{ownProfileData.name?.[0]}</AvatarFallback></Avatar>
                                     <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/png, image/jpeg, image/gif"/>
                                    <Button variant="outline" size="icon" className="absolute bottom-0 right-0 rounded-full h-8 w-8 bg-background" onClick={() => fileInputRef.current?.click()}><Camera className="h-4 w-4" /><span className="sr-only">Change profile picture</span></Button>
                                </div>
                                <SheetTitle className="text-2xl pt-2">{ownProfileData.name}</SheetTitle>
                                <SheetDescription>{ownProfileDetails.emailHandle}</SheetDescription>
                                <p className="text-sm text-foreground pt-2">{ownProfileDetails.role}</p>
                            </SheetHeader>
                            <div className="p-4 space-y-4">
                                 <div className="p-4 border rounded-lg"><h4 className="font-semibold mb-2">About Me</h4><p className="text-sm text-muted-foreground">{ownProfileDetails.bio || 'No bio yet.'}</p></div>
                                <Button className="w-full" onClick={() => setIsEditDialogOpen(true)}><Edit className="mr-2 h-4 w-4"/> Edit Profile</Button>
                                {(ownProfileData.role === 'creator' || ownProfileData.role === 'moderator') && (
                                    <Button variant="outline" className="w-full" onClick={() => { if (currentUser) { changeRole(currentUser.uid, 'listener'); setIsOwnProfileSheetOpen(false); } }}>
                                        <Headphones className="mr-2 h-4 w-4"/> Move to Listeners
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>

        </SubpageLayout>
    );
}
