
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onAuthStateChanged, User, updateProfile } from 'firebase/auth';
import { doc, setDoc, deleteDoc, updateDoc, writeBatch, deleteField, serverTimestamp, getDoc, query, orderBy, onSnapshot, addDoc, collection, getDocs, Timestamp, where } from 'firebase/firestore';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';
import 'webrtc-adapter';

import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db, auth, storage } from "@/lib/firebase";
import { Mic, MicOff, LogOut, XCircle, Hand, Check, X, Users, Headphones, UserPlus, UserCheck, MessageSquare, UserX, Link as LinkIcon, MoreVertical, Edit, ShieldCheck, TimerIcon, MessageSquareText, Send, Crown, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReactCrop, centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';


// Types
interface Room {
    id: string;
    title: string;
    description: string;
    creatorId: string;
    pinnedLink?: string;
    roles?: { [key: string]: 'speaker' | 'moderator' };
    createdAt: Timestamp;
}

interface Participant {
    id: string;
    name: string;
    avatar: string;
    isMuted: boolean;
    role: 'creator' | 'moderator' | 'speaker' | 'listener';
}

interface SpeakRequest {
    id: string;
    name: string;
    avatar: string;
}

interface RemoteStream {
    peerId: string;
    stream: MediaStream;
}

interface RoomChatMessage {
    id: string;
    text: string;
    senderId: string;
    senderName: string;
    senderAvatar: string;
    createdAt: Timestamp;
}

interface SpeakerInvitation {
    inviterId: string;
    inviterName: string;
}

interface ProfileStats {
    posts: number;
    followers: number;
    following: number;
}


const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
    const ref = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.srcObject = stream;
    }, [stream]);
    return <audio ref={ref} autoPlay playsInline />;
};

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

export default function AudioRoomPage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const roomId = params.roomId as string;

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Room State
    const [roomData, setRoomData] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [speakingRequests, setSpeakingRequests] = useState<SpeakRequest[]>([]);
    const [isMuted, setIsMuted] = useState(true);
    const [hasRequested, setHasRequested] = useState(false);
    const [speakerInvitation, setSpeakerInvitation] = useState<SpeakerInvitation | null>(null);
    const [elapsedTime, setElapsedTime] = useState('00:00');
    const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
    
    // WebRTC State
    const localStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<Record<string, PeerInstance>>({});
    const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);

    // In-room profile editing refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);

    // Dialog & Sheet states
    const [selectedUser, setSelectedUser] = useState<Participant | null>(null);
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
    const [linkToPin, setLinkToPin] = useState('');
    const [isTitleEditDialogOpen, setIsTitleEditDialogOpen] = useState(false);
    const [newRoomTitle, setNewRoomTitle] = useState('');
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [newChatMessage, setNewChatMessage] = useState('');
    const chatMessagesEndRef = useRef<HTMLDivElement>(null);
    const [isLeaveAlertOpen, setIsLeaveAlertOpen] = useState(false);
    const [isEndAlertOpen, setIsEndAlertOpen] = useState(false);

    useEffect(() => {
        const authUnsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
            } else {
                toast({ title: "Authentication required", description: "Please log in to join a room." });
                router.push('/sound-sphere');
            }
            setIsLoading(false);
        });
        return () => authUnsubscribe();
    }, [router, toast]);
    
    const leaveRoom = useCallback(async (isRedirecting = true) => {
        if (!roomId || !currentUser || !db) return;

        // Destroy peers and streams
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        setRemoteStreams([]);

        // Delete participant document
        const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        await deleteDoc(participantRef);

        const remainingParticipantsSnap = await getDocs(collection(db, "audioRooms", roomId, "participants"));
        if (remainingParticipantsSnap.empty) {
            await deleteDoc(doc(db, "audioRooms", roomId));
        }

        if (isRedirecting) {
            router.push('/sound-sphere?tab=rooms');
        }
    }, [roomId, currentUser, db, router]);


    // Main effect for joining room and setting up listeners
    useEffect(() => {
        if (!currentUser || !roomId || !db) return;

        let allUnsubscribes: (() => void)[] = [];

        const join = async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = stream;

            const roomDocRef = doc(db, "audioRooms", roomId);
            const roomSnap = await getDoc(roomDocRef);
            if (!roomSnap.exists()) {
                toast({ title: "Room not found or has ended." });
                router.push('/sound-sphere?tab=rooms');
                return;
            }

            const initialRoomData = roomSnap.data() as Room;
            const myRole = initialRoomData.creatorId === currentUser.uid ? 'creator' : (initialRoomData.roles?.[currentUser.uid] || 'listener');
            const initialMute = myRole === 'listener';
            setIsMuted(initialMute);
            if(localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !initialMute);

            await setDoc(doc(db, "audioRooms", roomId, "participants", currentUser.uid), {
                name: currentUser.displayName, avatar: currentUser.photoURL, isMuted: initialMute, role: myRole,
            }, { merge: true });

            allUnsubscribes.push(onSnapshot(roomDocRef, (docSnap) => {
                if (!docSnap.exists()) {
                    leaveRoom(); return;
                }
                setRoomData({ id: docSnap.id, ...docSnap.data() } as Room);
                setNewRoomTitle(docSnap.data()?.title || '');
            }));

            const participantsColRef = collection(db, "audioRooms", roomId, "participants");
            allUnsubscribes.push(onSnapshot(participantsColRef, (snapshot) => {
                const newParticipants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Participant));
                setParticipants(newParticipants);

                const currentPeerIds = Object.keys(peersRef.current);
                const newParticipantIds = new Set(newParticipants.map(p => p.id));

                newParticipants.forEach(p => {
                    if (p.id !== currentUser.uid && !peersRef.current[p.id] && localStreamRef.current) {
                        const isInitiator = currentUser.uid > p.id;
                        if (isInitiator) {
                            const peer = new Peer({ initiator: true, trickle: false, stream: localStreamRef.current, config: { iceServers } });
                            peer.on('signal', offerSignal => addDoc(collection(db, `audioRooms/${roomId}/signals`), { to: p.id, from: currentUser.uid, signal: JSON.stringify(offerSignal) }));
                            peer.on('stream', stream => setRemoteStreams(prev => [...prev, { peerId: p.id, stream }]));
                            peer.on('close', () => setRemoteStreams(prev => prev.filter(s => s.peerId !== p.id)));
                            peersRef.current[p.id] = peer;
                        }
                    }
                });
                currentPeerIds.forEach(peerId => {
                    if (!newParticipantIds.has(peerId)) {
                        peersRef.current[peerId]?.destroy();
                        delete peersRef.current[peerId];
                    }
                });
            }));
            
            const signalsQuery = query(collection(db, `audioRooms/${roomId}/signals`), where("to", "==", currentUser.uid));
            allUnsubscribes.push(onSnapshot(signalsQuery, (snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        const data = change.doc.data();
                        const signal = JSON.parse(data.signal);
                        const fromId = data.from;
                        if (signal.type === 'offer') {
                            if (peersRef.current[fromId] || !localStreamRef.current) return;
                            const peer = new Peer({ initiator: false, trickle: false, stream: localStreamRef.current, config: { iceServers } });
                            peer.on('signal', answerSignal => addDoc(collection(db, `audioRooms/${roomId}/signals`), { to: fromId, from: currentUser.uid, signal: JSON.stringify(answerSignal) }));
                            peer.on('stream', stream => setRemoteStreams(prev => [...prev.filter(s => s.peerId !== fromId), { peerId: fromId, stream }]));
                            peer.on('close', () => setRemoteStreams(prev => prev.filter(s => s.peerId !== fromId)));
                            peersRef.current[fromId] = peer;
                            peer.signal(signal);
                        } else if (signal.type === 'answer') {
                            peersRef.current[fromId]?.signal(signal);
                        }
                        await deleteDoc(change.doc.ref);
                    }
                });
            }));
            
            allUnsubscribes.push(onSnapshot(collection(db, "audioRooms", roomId, "requests"), s => setSpeakingRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as SpeakRequest)))));
            allUnsubscribes.push(onSnapshot(query(collection(db, "audioRooms", roomId, "chatMessages"), orderBy("createdAt", "asc")), s => setChatMessages(s.docs.map(d => ({ id: d.id, ...d.data() } as RoomChatMessage)))));
            allUnsubscribes.push(onSnapshot(doc(db, "audioRooms", roomId, "invitations", currentUser.uid), d => setSpeakerInvitation(d.exists() ? d.data() as SpeakerInvitation : null)));

            getDoc(doc(db, "audioRooms", roomId, "requests", currentUser.uid)).then(snap => setHasRequested(snap.exists()));
        };

        join();

        return () => {
            allUnsubscribes.forEach(unsub => unsub());
            leaveRoom(false);
        };
    }, [currentUser, roomId, db, router, toast, leaveRoom]);
    
    // Auto-moderator promotion logic
    useEffect(() => {
        if (participants.length === 0 || !roomData || !db || !currentUser) return;
        const admins = participants.filter(p => p.role === 'creator' || p.role === 'moderator');
        if (admins.length > 0) return;
        const speakers = participants.filter(p => p.role === 'speaker');
        if (speakers.length > 0) {
            const newModerator = speakers[0];
            if (roomData.roles?.[newModerator.id] !== 'moderator') {
                updateDoc(doc(db, "audioRooms", roomId, "participants", newModerator.id), { role: 'moderator' });
            }
        }
    }, [participants, roomData, db, roomId, currentUser]);

    useEffect(() => { chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
    useEffect(() => {
        if (!roomData?.createdAt) return;
        const interval = setInterval(() => {
            const diff = new Date().getTime() - roomData.createdAt.toDate().getTime();
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            setElapsedTime(h > 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
        }, 1000);
        return () => clearInterval(interval);
    }, [roomData?.createdAt]);

    const handleEndRoom = async () => { await deleteDoc(doc(db, "audioRooms", roomId)); leaveRoom(); };
    const toggleMute = async () => {
        if (!localStreamRef.current || !currentUser) return;
        const newMutedState = !isMuted;
        localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !newMutedState);
        setIsMuted(newMutedState);
        await updateDoc(doc(db, "audioRooms", roomId, "participants", currentUser.uid), { isMuted: newMutedState });
    };
    const requestToSpeak = async () => {
        if (!currentUser) return;
        await setDoc(doc(db, "audioRooms", roomId, "requests", currentUser.uid), { name: currentUser.displayName, avatar: currentUser.photoURL });
        setHasRequested(true);
        toast({ title: "Request Sent" });
    };
    const manageRequest = async (requesterId: string, accept: boolean) => {
        await deleteDoc(doc(db, "audioRooms", roomId, "requests", requesterId));
        if (accept && currentUser) {
            await setDoc(doc(db, "audioRooms", roomId, "invitations", requesterId), { inviterId: currentUser.uid, inviterName: currentUser.displayName });
        }
    };
    const changeRole = async (targetId: string, newRole: 'moderator' | 'speaker' | 'listener') => {
        await updateDoc(doc(db, "audioRooms", roomId, "participants", targetId), { role: newRole, isMuted: newRole === 'listener' });
        toast({ title: "Role Updated" });
    };
    const acceptInvite = async () => {
        if (!currentUser) return;
        await updateDoc(doc(db, "audioRooms", roomId, "participants", currentUser.uid), { role: 'speaker', isMuted: false });
        await deleteDoc(doc(db, "audioRooms", roomId, "invitations", currentUser.uid));
        setIsMuted(false);
        if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = true);
        toast({ title: "You are now a speaker!" });
    };
    const declineInvite = async () => {
        if (!currentUser) return;
        await deleteDoc(doc(db, "audioRooms", roomId, "invitations", currentUser.uid));
    };
    const removeUser = async (targetId: string) => {
        if (!currentUser) return;
        const batch = writeBatch(db);
        batch.set(doc(db, "audioRooms", roomId, "bannedUsers", targetId), { bannedAt: serverTimestamp(), bannedBy: currentUser.uid });
        batch.delete(doc(db, "audioRooms", roomId, "participants", targetId));
        await batch.commit();
        toast({ title: "User Banned" });
    };
    const selfPromoteToSpeaker = async () => {
        if (!currentUser) return;
        await updateDoc(doc(db, "audioRooms", roomId, "participants", currentUser.uid), { role: 'speaker', isMuted: false });
        setIsMuted(false);
        if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = true);
    };
    const pinLink = async (e: React.FormEvent) => {
        e.preventDefault();
        await updateDoc(doc(db, "audioRooms", roomId), { pinnedLink: linkToPin });
        setIsPinLinkDialogOpen(false);
        setLinkToPin('');
        toast({ title: "Link Pinned" });
    };
    const unpinLink = async () => await updateDoc(doc(db, "audioRooms", roomId), { pinnedLink: deleteField() });
    const updateRoomTitle = async (e: React.FormEvent) => {
        e.preventDefault();
        await updateDoc(doc(db, "audioRooms", roomId), { title: newRoomTitle });
        setIsTitleEditDialogOpen(false);
    };
    const sendChatMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser || !newChatMessage.trim()) return;
        await addDoc(collection(db, "audioRooms", roomId, "chatMessages"), { text: newChatMessage, senderId: currentUser.uid, senderName: currentUser.displayName, senderAvatar: currentUser.photoURL, createdAt: serverTimestamp() });
        setNewChatMessage('');
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
        batch.update(doc(db, "audioRooms", roomId, "participants", currentUser.uid), { name: newDisplayName });
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
        setIsCropDialogOpen(false);
    };

    const handlePictureUpload = async (file: File) => {
        if (!storage || !currentUser || !db) return;
        const filePath = `profile-pictures/${currentUser.uid}/${Date.now()}-${file.name}`;
        const fileRef = storageRef(storage, filePath);
        try {
            toast({ title: 'Uploading...' });
            const uploadResult = await uploadBytes(fileRef, file);
            const photoURL = await getDownloadURL(uploadResult.ref);
            await updateProfile(currentUser, { photoURL });
            const batch = writeBatch(db);
            batch.update(doc(db, "users", currentUser.uid), { photoURL });
            batch.update(doc(db, "audioRooms", roomId, "participants", currentUser.uid), { avatar: photoURL });
            await batch.commit();
            setOwnProfileData(prev => prev ? { ...prev, avatar: photoURL } : null);
            toast({ title: 'Success!', description: 'Profile picture updated.' });
        } catch (error: any) {
            toast({ title: 'Upload Failed', variant: 'destructive' });
        }
    };

    if (isLoading || !roomData || !currentUser) {
        return <SubpageLayout title="Sound Sphere Room" backHref="/sound-sphere?tab=rooms"><div className="text-center">Loading room...</div></SubpageLayout>;
    }

    const myParticipantData = participants.find(p => p.id === currentUser.uid);
    const myRole = myParticipantData?.role;
    const isModerator = myRole === 'creator' || myRole === 'moderator';
    const canSpeak = isModerator || myRole === 'speaker';
    
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
        <SubpageLayout title={roomData.title} backHref="/sound-sphere?tab=rooms" showTitle={false}>
            {remoteStreams.map(rs => <AudioPlayer key={rs.peerId} stream={rs.stream} />)}
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
            <div className="mx-auto max-w-4xl space-y-8">
                <div className="text-left space-y-2">
                    <div className="flex items-center gap-2">
                        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl font-headline">{roomData.title}</h1>
                        {isModerator && (
                             <Dialog open={isTitleEditDialogOpen} onOpenChange={setIsTitleEditDialogOpen}>
                                <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><Edit className="h-5 w-5" /></Button></DialogTrigger>
                                <DialogContent>
                                    <DialogHeader><DialogTitle>Edit Room Title</DialogTitle></DialogHeader>
                                    <form onSubmit={updateRoomTitle} className="space-y-4">
                                        <Input value={newRoomTitle} onChange={(e) => setNewRoomTitle(e.target.value)} />
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
                        <form onSubmit={pinLink}><div className="grid gap-4 py-4"><Input placeholder="https://example.com" value={linkToPin} onChange={(e) => setLinkToPin(e.target.value)}/></div><Button type="submit">Pin Link</Button></form>
                    </DialogContent>
                </Dialog>

                <div className="flex flex-wrap items-center justify-center gap-2">
                    <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
                        <SheetTrigger asChild><Button variant="outline" className="sm:w-auto w-full"><MessageSquareText className="mr-2 h-5 w-5" /> Chat</Button></SheetTrigger>
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
                                    <div ref={chatMessagesEndRef} />
                                </div>
                            </ScrollArea>
                            <form onSubmit={sendChatMessage} className="flex items-center gap-2 pt-4 border-t">
                                <Textarea value={newChatMessage} onChange={(e) => setNewChatMessage(e.target.value)} placeholder="Send a message..." rows={1} className="min-h-0"/><Button type="submit" size="icon" disabled={!newChatMessage.trim()}><Send className="h-4 w-4"/></Button>
                            </form>
                        </SheetContent>
                    </Sheet>
                     {canSpeak ? (
                        <>
                            <Button variant={isMuted ? 'secondary' : 'outline'} onClick={toggleMute} className="w-28">{isMuted ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />} {isMuted ? 'Unmute' : 'Mute'}</Button>
                            <Button variant="outline" onClick={() => setIsPinLinkDialogOpen(true)}><LinkIcon className="mr-2 h-5 w-5" /> Pin Link</Button>
                        </>
                     ) : (
                        isOpenStage ? (
                            <Button onClick={selfPromoteToSpeaker} variant="outline"><Mic className="mr-2 h-5 w-5" /> Become a Speaker</Button>
                        ) : (
                            <Button onClick={requestToSpeak} disabled={hasRequested} variant="outline"><Hand className="mr-2 h-5 w-5" />{hasRequested ? 'Request Sent' : 'Request to Speak'}</Button>
                        )
                     )}
                     <AlertDialog open={isLeaveAlertOpen} onOpenChange={setIsLeaveAlertOpen}>
                        <AlertDialogTrigger asChild><Button variant="outline" className="sm:w-auto w-full"><LogOut className="mr-2 h-5 w-5" />Leave</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Leave the room?</AlertDialogTitle><AlertDialogDescription>Are you sure you want to leave this room?</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => leaveRoom()}>Leave</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    {isModerator && (
                         <AlertDialog open={isEndAlertOpen} onOpenChange={setIsEndAlertOpen}>
                            <AlertDialogTrigger asChild><Button variant="destructive" className="sm:w-auto w-full"><XCircle className="mr-2 h-5 w-5" />End Room</Button></AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>End the room?</AlertDialogTitle><AlertDialogDescription>This will permanently close the room for everyone. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleEndRoom} className="bg-destructive hover:bg-destructive/90">End Room</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
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
