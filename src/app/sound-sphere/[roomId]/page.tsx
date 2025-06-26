
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db } from "@/lib/firebase";
import { updateProfile } from 'firebase/auth';
import { doc, collection, setDoc, deleteDoc, updateDoc, writeBatch, deleteField, serverTimestamp, getDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Mic, MicOff, LogOut, XCircle, Hand, Check, X, Users, Headphones, UserPlus, UserCheck, MessageSquare, UserX, Link as LinkIcon, MoreVertical, Edit, ShieldCheck, TimerIcon, MessageSquareText, Send, Crown, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReactCrop, centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useFloatingRoom, type Participant } from '@/components/layout/chat-launcher';


// Helper functions for image cropping
function canvasPreview(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  crop: PixelCrop,
) {
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('No 2d context')
  }
  
  const scaleX = image.naturalWidth / image.width
  const scaleY = image.naturalHeight / image.height
  const pixelRatio = window.devicePixelRatio
  
  canvas.width = Math.floor(crop.width * scaleX * pixelRatio)
  canvas.height = Math.floor(crop.height * scaleY * pixelRatio)

  ctx.scale(pixelRatio, pixelRatio)
  ctx.imageSmoothingQuality = 'high'

  const cropX = crop.x * scaleX
  const cropY = crop.y * scaleY
  
  const centerX = image.naturalWidth / 2
  const centerY = image.naturalHeight / 2

  ctx.save()
  ctx.translate(-cropX, -cropY)
  ctx.translate(centerX, centerY)
  ctx.translate(-centerX, -centerY)
  ctx.drawImage(
    image,
    0,
    0,
    image.naturalWidth,
    image.naturalHeight,
    0,
    0,
    image.naturalWidth,
    image.naturalHeight,
  )

  ctx.restore()
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}


export default function AudioRoomPage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const roomId = params.roomId as string;
    
    const {
        currentUser,
        roomData,
        participants,
        speakingRequests,
        isMuted,
        hasRequested,
        speakerInvitation,
        elapsedTime,
        chatMessages,
        followingIds,
        blockedIds,
        profileStats,
        isStatsLoading,
        joinRoom,
        leaveRoom,
        endRoom,
        toggleMute,
        requestToSpeak,
        manageRequest,
        handleFollowToggle,
        handleBlockUser,
        pinLink,
        unpinLink,
        updateRoomTitle,
        sendChatMessage,
        changeRole,
        acceptInvite,
        declineInvite,
        removeUser,
        showFloatingPlayer,
        storage,
        isRoomLoading,
    } = useFloatingRoom();
    
    // In-room profile editing refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);

    const [isLoading, setIsLoading] = useState(true);
    
    // Profile Dialog State
    const [selectedUser, setSelectedUser] = useState<Participant | null>(null);
    
    // In-room Self Profile Sheet state
    const [isOwnProfileSheetOpen, setIsOwnProfileSheetOpen] = useState(false);
    const [ownProfileData, setOwnProfileData] = useState<Participant | null>(null);
    const [ownProfileDetails, setOwnProfileDetails] = useState<{bio?: string, role: string, firstName: string, lastName: string, emailHandle: string} | null>(null);

    // Edit Profile Dialog State
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editedFirstName, setEditedFirstName] = useState('');
    const [editedLastName, setEditedLastName] = useState('');
    const [editedRole, setEditedRole] = useState('');
    const [editedBio, setEditedBio] = useState('');

    // Crop Dialog State
    const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
    const [imgSrc, setImgSrc] = useState('');
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();


    // Pinned Link State
    const [isPinLinkDialogOpen, setIsPinLinkDialogOpen] = useState(false);
    const [linkToPin, setLinkToPin] = useState('');

    // Title Edit State
    const [isTitleEditDialogOpen, setIsTitleEditDialogOpen] = useState(false);
    const [newRoomTitle, setNewRoomTitle] = useState('');

    // Chat State
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [newChatMessage, setNewChatMessage] = useState('');
    const chatMessagesEndRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        joinRoom(roomId);
        setIsLoading(false);
    }, [roomId, joinRoom]);
    
    useEffect(() => {
        if (!roomData) return;
        setNewRoomTitle(roomData.title);
    }, [roomData?.title]);

    useEffect(() => {
        if (roomData === null && !isRoomLoading) {
            toast({ title: "Room not found or has ended." });
            router.push('/sound-sphere?tab=rooms');
        }
    }, [roomData, isRoomLoading, router, toast]);

    useEffect(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages]);

    const handleLeaveRoom = async () => {
        leaveRoom();
        router.push('/sound-sphere?tab=rooms'); 
    };

    const handleEndRoomAndRedirect = async () => {
        await endRoom();
        router.push('/sound-sphere');
    }
    
    const handleNavigateWithPlayer = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        showFloatingPlayer();
        router.push('/sound-sphere?tab=rooms');
    };

    const handlePinLink = async (e: React.FormEvent) => {
        e.preventDefault();
        await pinLink(linkToPin);
        setIsPinLinkDialogOpen(false);
        setLinkToPin('');
    };

    const handleTitleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        await updateRoomTitle(newRoomTitle);
        setIsTitleEditDialogOpen(false);
    };
    
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        await sendChatMessage(newChatMessage);
        setNewChatMessage('');
    };
    
    const handleOpenOwnProfile = async () => {
        if (!db || !currentUser) return;
        const participant = participants.find(p => p.id === currentUser.uid);
        if (!participant) return;
        setOwnProfileData(participant);
        
        const userDocRef = doc(db, "users", participant.id);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            const profileDetails = {
                bio: data.bio || '',
                role: data.role || '',
                firstName: data.firstName || '',
                lastName: data.lastName || '',
                emailHandle: `@${data.email?.split('@')[0] || ''}`,
            };
            setOwnProfileDetails(profileDetails);
            setEditedFirstName(profileDetails.firstName);
            setEditedLastName(profileDetails.lastName);
            setEditedRole(profileDetails.role);
            setEditedBio(profileDetails.bio);
        }
        setIsOwnProfileSheetOpen(true);
    };
    
    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser) return;
        
        const userDocRef = doc(db, "users", currentUser.uid);
        const roomParticipantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        const newDisplayName = `${editedFirstName} ${editedLastName}`;

        try {
            const batch = writeBatch(db);
            
            batch.update(userDocRef, {
                firstName: editedFirstName,
                lastName: editedLastName,
                role: editedRole,
                bio: editedBio,
            });
            
            batch.update(roomParticipantRef, { name: newDisplayName });
            
            await batch.commit();
            await updateProfile(currentUser, { displayName: newDisplayName });
            
            setOwnProfileDetails(prev => prev ? { 
                ...prev,
                firstName: editedFirstName,
                lastName: editedLastName,
                role: editedRole,
                bio: editedBio,
            } : null);
             setOwnProfileData(prev => prev ? { ...prev, name: newDisplayName } : null);
            
            setIsEditDialogOpen(false);
            toast({ title: 'Profile Updated', description: 'Your information has been saved.' });
        } catch (error) {
            console.error("Error updating profile:", error);
            toast({ title: 'Update Failed', description: 'Could not save your changes.', variant: 'destructive' });
        }
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
        setIsCropDialogOpen(false);
    };

    const handlePictureUpload = async (file: File) => {
        if (!storage || !currentUser || !db) return;
        
        const filePath = `profile-pictures/${currentUser.uid}/${Date.now()}-${file.name}`;
        const fileRef = storageRef(storage, filePath);
        
        try {
            toast({ title: 'Uploading...', description: 'Your new profile picture is being uploaded.' });
            const uploadResult = await uploadBytes(fileRef, file);
            const photoURL = await getDownloadURL(uploadResult.ref);

            await updateProfile(currentUser, { photoURL });

            const userDocRef = doc(db, "users", currentUser.uid);
            const roomParticipantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);

            const batch = writeBatch(db);
            batch.update(userDocRef, { photoURL });
            batch.update(roomParticipantRef, { avatar: photoURL });
            await batch.commit();
            
            setOwnProfileData(prev => prev ? { ...prev, avatar: photoURL } : null);
            toast({ title: 'Success!', description: 'Profile picture updated.' });
        } catch (error: any) {
            console.error("Error uploading profile picture:", error);
            toast({ title: 'Upload Failed', description: 'Could not upload new picture.', variant: 'destructive' });
        }
    };


    if (isLoading || isRoomLoading || !roomData || !currentUser) {
        return <SubpageLayout title="Sound Sphere Room" backHref="/sound-sphere?tab=rooms"><div className="text-center">Loading room...</div></SubpageLayout>;
    }

    const myParticipantData = participants.find(p => p.id === currentUser.uid);
    const myRole = myParticipantData?.role;
    const isModerator = myRole === 'creator' || myRole === 'moderator';
    const canSpeak = isModerator || myRole === 'speaker';
    const isFollowingSelected = selectedUser && followingIds.includes(selectedUser.id);
    
    const speakers = participants.filter(p => p.role === 'creator' || p.role === 'moderator' || p.role === 'speaker');
    const listeners = participants.filter(p => p.role === 'listener');
    
    const renderParticipant = (p: Participant) => {
        const isUnmutedSpeaker = (p.role !== 'listener') && !p.isMuted;
        
        return (
            <button
                key={p.id}
                onClick={() => {
                    if (p.id === currentUser.uid) {
                        handleOpenOwnProfile();
                    } else {
                        setSelectedUser(p);
                    }
                }}
                className="relative flex flex-col items-center gap-2 cursor-pointer transition-transform hover:scale-105"
            >
                <div className="relative">
                    <Avatar className={cn(
                        'h-16 w-16 sm:h-20 sm:w-20 border-4',
                        isUnmutedSpeaker ? 'border-green-500' : 'border-transparent'
                    )}>
                        <AvatarImage src={p.avatar} data-ai-hint="person portrait"/>
                        <AvatarFallback>{p.name?.[0]}</AvatarFallback>
                    </Avatar>
                     {(p.isMuted || p.role === 'listener') && (
                        <div className="absolute top-0 right-0 bg-slate-700 rounded-full p-1 border-2 border-background">
                            <MicOff className="h-3 w-3 text-slate-100" />
                        </div>
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
        <SubpageLayout title={roomData.title} backHref="/sound-sphere?tab=rooms" showTitle={false} onBackClick={handleNavigateWithPlayer}>
            
            <AlertDialog open={!!speakerInvitation}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{speakerInvitation?.inviterName} has invited you to speak!</AlertDialogTitle>
                        <AlertDialogDescription>
                            Would you like to join the speakers on stage?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={declineInvite}>Decline</AlertDialogCancel>
                        <AlertDialogAction onClick={acceptInvite}>Accept</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>


            <div className="mx-auto max-w-4xl space-y-8">
                 <div className="text-left space-y-2">
                    <div className="flex items-center gap-2">
                        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl font-headline">{roomData.title}</h1>
                        {isModerator && (
                             <Dialog open={isTitleEditDialogOpen} onOpenChange={setIsTitleEditDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8"><Edit className="h-5 w-5" /></Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Edit Room Title</DialogTitle>
                                    </DialogHeader>
                                    <form onSubmit={handleTitleUpdate} className="space-y-4">
                                        <Input value={newRoomTitle} onChange={(e) => setNewRoomTitle(e.target.value)} />
                                        <DialogFooter>
                                            <Button type="submit">Save Changes</Button>
                                        </DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                        )}
                    </div>
                    <p className="text-lg text-muted-foreground">{roomData.description}</p>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <TimerIcon className="h-4 w-4" />
                        <p className="text-sm font-mono">{elapsedTime}</p>
                    </div>
                </div>
                {roomData.pinnedLink && (
                     <Card>
                        <CardContent className="p-3 flex items-center justify-between">
                             <div className="flex items-center gap-3">
                                 <LinkIcon className="h-5 w-5 text-primary"/>
                                 <a href={roomData.pinnedLink} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline truncate">
                                     {roomData.pinnedLink}
                                 </a>
                             </div>
                             {canSpeak && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                            <MoreVertical className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuItem onClick={unpinLink}>
                                            <X className="mr-2 h-4 w-4"/> Unpin Link
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                             )}
                        </CardContent>
                    </Card>
                )}
                 {isModerator && speakingRequests.length > 0 && (
                     <Card className="border-primary">
                        <CardHeader>
                            <CardTitle>Speaking Requests ({speakingRequests.length})</CardTitle>
                            <CardDescription>Accept or deny requests to speak from listeners.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {speakingRequests.map(req => (
                                <div key={req.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-10 w-10">
                                            <AvatarImage src={req.avatar} />
                                            <AvatarFallback>{req.name?.[0]}</AvatarFallback>
                                        </Avatar>
                                        <p className="font-medium">{req.name}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="icon" variant="outline" className="bg-red-500/20 text-red-700 hover:bg-red-500/30" onClick={() => manageRequest(req.id, false)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                         <Button size="icon" variant="outline" className="bg-green-500/20 text-green-700 hover:bg-green-500/30" onClick={() => manageRequest(req.id, true)}>
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
                <Dialog open={!!selectedUser} onOpenChange={(isOpen) => !isOpen && setSelectedUser(null)}>
                    <div className="space-y-6">
                        <Card>
                            <CardHeader className="flex flex-row items-center gap-2">
                                <Mic className="h-5 w-5 text-primary" />
                                <CardTitle>Speakers ({speakers.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-y-4 gap-x-2">
                                {speakers.map(renderParticipant)}
                                 {speakers.length === 0 && <p className="text-muted-foreground col-span-full text-center">No speakers yet.</p>}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center gap-2">
                                <Headphones className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Listeners ({listeners.length})</CardTitle>
                            </CardHeader>
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
                                     <Avatar className="h-24 w-24 border-2 border-primary">
                                        <AvatarImage src={selectedUser.avatar} alt={selectedUser.name} />
                                        <AvatarFallback className="text-3xl">{selectedUser.name?.[0]}</AvatarFallback>
                                    </Avatar>
                                    <DialogTitle className="text-2xl pt-2">{selectedUser.name}</DialogTitle>
                                </DialogHeader>
                                 <div className="grid grid-cols-3 justify-around text-center py-4 border-y divide-x">
                                    {isStatsLoading ? (
                                        <div className="col-span-3 text-muted-foreground">Loading...</div>
                                    ) : profileStats ? (
                                        <>
                                            <div className="px-2">
                                                <p className="font-bold text-lg">{profileStats.posts}</p>
                                                <p className="text-sm text-muted-foreground">Posts</p>
                                            </div>
                                            <div className="px-2">
                                                <p className="font-bold text-lg">{profileStats.followers}</p>
                                                <p className="text-sm text-muted-foreground">Followers</p>
                                            </div>
                                            <div className="px-2">
                                                <p className="font-bold text-lg">{profileStats.following}</p>
                                                <p className="text-sm text-muted-foreground">Following</p>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="col-span-3 text-muted-foreground">Could not load stats.</div>
                                    )}
                                </div>
                                <div className="space-y-2 pt-4">
                                     <div className="flex justify-center gap-2">
                                        <Button onClick={handleFollowToggle}>
                                            {isFollowingSelected ? <UserCheck className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                            {isFollowingSelected ? 'Following' : 'Follow'}
                                        </Button>
                                        <Button variant="outline" onClick={() => {
                                            if (!selectedUser) return;
                                            window.dispatchEvent(new CustomEvent('open-chat', { detail: { userId: selectedUser.id } }));
                                            setSelectedUser(null);
                                        }}>
                                            <MessageSquare className="mr-2 h-4 w-4" /> Message
                                        </Button>
                                        <Button variant="destructive" onClick={() => {
                                             if (selectedUser) {
                                                handleBlockUser(selectedUser.id);
                                                setSelectedUser(null);
                                             }
                                        }}>
                                            <UserX className="mr-2 h-4 w-4" /> Block
                                        </Button>
                                    </div>
                                    {canManageSelectedUser && selectedUser.role !== 'creator' && <div className="border-t pt-4 space-y-2">
                                        <p className="text-sm font-medium text-center">Moderator Actions</p>
                                        <div className="flex flex-wrap justify-center gap-2">
                                            {selectedUser.role === 'listener' && <Button size="sm" onClick={() => changeRole(selectedUser.id, 'speaker')}>Invite to Speak</Button>}
                                            {selectedUser.role === 'speaker' && (
                                                <>
                                                    <Button size="sm" onClick={() => changeRole(selectedUser.id, 'moderator')}>Make Moderator</Button>
                                                    <Button size="sm" variant="outline" onClick={() => changeRole(selectedUser.id, 'listener')}>Move to Listeners</Button>
                                                </>
                                            )}
                                            {selectedUser.role === 'moderator' && (
                                                <>
                                                    <Button size="sm" onClick={() => changeRole(selectedUser.id, 'speaker')}>Demote to Speaker</Button>
                                                    <Button size="sm" variant="outline" onClick={() => changeRole(selectedUser.id, 'listener')}>Move to Listeners</Button>
                                                </>
                                            )}
                                             <Button size="sm" variant="destructive" onClick={() => {
                                                if (selectedUser) {
                                                    removeUser(selectedUser.id);
                                                    setSelectedUser(null);
                                                }
                                             }}>
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
                        <DialogHeader>
                            <DialogTitle>Pin a Link</DialogTitle>
                            <DialogDescription>
                                Share a relevant link with everyone in the room. It will appear at the top.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handlePinLink}>
                            <div className="grid gap-4 py-4">
                                <Input 
                                    placeholder="https://example.com" 
                                    value={linkToPin} 
                                    onChange={(e) => setLinkToPin(e.target.value)}
                                />
                            </div>
                            <Button type="submit">Pin Link</Button>
                        </form>
                    </DialogContent>
                </Dialog>

                <div className="flex flex-wrap items-center justify-center gap-2">
                    <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" className="sm:w-auto w-full"><MessageSquareText className="mr-2 h-5 w-5" /> Chat</Button>
                        </SheetTrigger>
                        <SheetContent className="flex flex-col">
                            <SheetHeader>
                                <SheetTitle>Live Chat</SheetTitle>
                            </SheetHeader>
                            <ScrollArea className="flex-1 -mx-6 px-6 mt-4">
                                <div className="space-y-4 pr-1 pb-4">
                                    {chatMessages.map(msg => (
                                        <div key={msg.id} className="flex items-start gap-3">
                                             <Avatar className="h-8 w-8">
                                                <AvatarImage src={msg.senderAvatar} />
                                                <AvatarFallback>{msg.senderName?.[0]}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="text-sm font-semibold">{msg.senderName}</p>
                                                <p className="text-sm bg-muted p-2 rounded-lg mt-1">{msg.text}</p>
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={chatMessagesEndRef} />
                                </div>
                            </ScrollArea>
                             <form onSubmit={handleSendMessage} className="flex items-center gap-2 pt-4 border-t">
                                <Textarea value={newChatMessage} onChange={(e) => setNewChatMessage(e.target.value)} placeholder="Send a message..." rows={1} className="min-h-0"/>
                                <Button type="submit" size="icon" disabled={!newChatMessage.trim()}><Send className="h-4 w-4"/></Button>
                            </form>
                        </SheetContent>
                    </Sheet>
                     {canSpeak ? (
                        <>
                        <Button
                            variant={isMuted ? 'secondary' : 'outline'}
                            onClick={toggleMute}
                            className="w-28"
                        >
                            {isMuted ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                            {isMuted ? 'Unmute' : 'Mute'}
                        </Button>
                        <Button variant="outline" onClick={() => setIsPinLinkDialogOpen(true)}>
                            <LinkIcon className="mr-2 h-5 w-5" />
                            Pin Link
                        </Button>
                        </>
                     ) : (
                         <Button
                            onClick={requestToSpeak}
                            disabled={hasRequested}
                            variant="outline"
                         >
                            <Hand className="mr-2 h-5 w-5" />
                            {hasRequested ? 'Request Sent' : 'Request to Speak'}
                         </Button>
                     )}
                    <Button variant="outline" onClick={handleLeaveRoom} className="sm:w-auto w-full">
                        <LogOut className="mr-2 h-5 w-5" />
                        Leave
                    </Button>
                    {isModerator && myRole === 'creator' && (
                        <Button variant="destructive" onClick={handleEndRoomAndRedirect} className="sm:w-auto w-full">
                            <XCircle className="mr-2 h-5 w-5" />
                            End Room
                        </Button>
                    )}
                </div>
            </div>

            <Dialog open={isCropDialogOpen} onOpenChange={setIsCropDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Crop your new picture</DialogTitle>
                        <DialogDescription>
                            Adjust the image to fit perfectly.
                        </DialogDescription>
                    </DialogHeader>
                    {imgSrc && (
                        <div className="flex justify-center">
                            <ReactCrop
                                crop={crop}
                                onChange={(_, percentCrop) => setCrop(percentCrop)}
                                onComplete={(c) => setCompletedCrop(c)}
                                aspect={1}
                                minWidth={100}
                                minHeight={100}
                                circularCrop
                            >
                                <img
                                    ref={imgRef}
                                    alt="Crop me"
                                    src={imgSrc}
                                    style={{ maxHeight: '70vh' }}
                                    onLoad={onImageLoad}
                                />
                            </ReactCrop>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCropDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveCrop} disabled={!completedCrop}>Save Picture</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {completedCrop && (
              <canvas
                ref={previewCanvasRef}
                style={{
                  display: 'none',
                  objectFit: 'contain',
                  width: completedCrop.width,
                  height: completedCrop.height,
                }}
              />
            )}
            
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Your Profile</DialogTitle>
                        <DialogDescription>
                            Make changes to your profile here. Click save when you're done.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleProfileUpdate} className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="firstName">First Name</Label>
                                <Input id="firstName" value={editedFirstName} onChange={(e) => setEditedFirstName(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastName">Last Name</Label>
                                <Input id="lastName" value={editedLastName} onChange={(e) => setEditedLastName(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="role">Role</Label>
                            <Input id="role" value={editedRole} onChange={(e) => setEditedRole(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="bio">Bio</Label>
                            <Textarea id="bio" placeholder="Tell us a bit about yourself..." value={editedBio} onChange={(e) => setEditedBio(e.target.value)} />
                        </div>
                        <DialogFooter>
                            <Button type="submit">Save Changes</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            
            <Sheet open={isOwnProfileSheetOpen} onOpenChange={setIsOwnProfileSheetOpen}>
                <SheetContent>
                    {ownProfileData && ownProfileDetails && (
                        <>
                            <SheetHeader className="items-center text-center pt-4">
                                <div className="relative">
                                    <Avatar className="h-24 w-24 border-2 border-primary">
                                        <AvatarImage src={ownProfileData.avatar} alt={ownProfileData.name} />
                                        <AvatarFallback className="text-3xl">{ownProfileData.name?.[0]}</AvatarFallback>
                                    </Avatar>
                                     <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileSelect}
                                        className="hidden"
                                        accept="image/png, image/jpeg, image/gif"
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="absolute bottom-0 right-0 rounded-full h-8 w-8 bg-background"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Camera className="h-4 w-4" />
                                        <span className="sr-only">Change profile picture</span>
                                    </Button>
                                </div>
                                
                                <SheetTitle className="text-2xl pt-2">{ownProfileData.name}</SheetTitle>
                                <DialogDescription>{ownProfileDetails.emailHandle}</DialogDescription>
                                <p className="text-sm text-foreground pt-2">{ownProfileDetails.role}</p>
                            </SheetHeader>
                            <div className="p-4 space-y-4">
                                 <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2">About Me</h4>
                                    <p className="text-sm text-muted-foreground">{ownProfileDetails.bio || 'No bio yet.'}</p>
                                </div>
                                <Button className="w-full" onClick={() => setIsEditDialogOpen(true)}>
                                    <Edit className="mr-2 h-4 w-4"/> Edit Profile
                                </Button>
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>

        </SubpageLayout>
    );
}

    