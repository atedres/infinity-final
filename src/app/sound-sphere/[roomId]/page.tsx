
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, updateDoc, getDocs, query, where, addDoc, serverTimestamp, Timestamp, writeBatch, deleteField } from 'firebase/firestore';
import { Mic, MicOff, LogOut, XCircle, Hand, Check, X, Users, Headphones, UserPlus, UserCheck, MessageSquare, UserX, Link as LinkIcon, MoreVertical, PictureInPicture, Edit, ShieldCheck, TimerIcon, MessageSquareText, Send, Crown } from 'lucide-react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';
import 'webrtc-adapter';
import { cn } from '@/lib/utils';


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

interface ChatMessage {
    id: string;
    text: string;
    senderId: string;
    senderName: string;
    senderAvatar: string;
    createdAt: Timestamp;
}

const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
    const ref = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (ref.current) {
            ref.current.srcObject = stream;
        }
    }, [stream]);

    return <audio ref={ref} autoPlay playsInline />;
};

const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: "stun:stun.services.mozilla.com" },
    { urls: "stun:stun.ekiga.net" },
    { urls: "stun:stun.ideasip.com" },
    { urls: "stun:stun.voiparound.com" },
    { urls: "stun:stun.voipraider.com" },
    { urls: "stun:stun.voipstunt.com" },
    { urls: "stun:stun.voxgratia.org" },
    { urls: "stun:stun.xten.com" },
];

export default function AudioRoomPage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const roomId = params.roomId as string;

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [speakingRequests, setSpeakingRequests] = useState<SpeakRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isMuted, setIsMuted] = useState(true);
    const [hasRequested, setHasRequested] = useState(false);
    
    const localStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<Record<string, PeerInstance>>({});
    const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
    const cleanupRef = useRef<() => void>();

    // Profile Dialog State
    const [selectedUser, setSelectedUser] = useState<Participant | null>(null);
    const [followingIds, setFollowingIds] = useState<string[]>([]);
    const [blockedIds, setBlockedIds] = useState<string[]>([]);
    const [profileStats, setProfileStats] = useState<{posts: number, followers: number, following: number} | null>(null);
    const [isStatsLoading, setIsStatsLoading] = useState(false);
    
    // Pinned Link State
    const [pinnedLink, setPinnedLink] = useState<string | null>(null);
    const [isPinLinkDialogOpen, setIsPinLinkDialogOpen] = useState(false);
    const [linkToPin, setLinkToPin] = useState('');

    // PiP State
    const pipVideoRef = useRef<HTMLVideoElement>(null);
    const pipCanvasRef = useRef<HTMLCanvasElement>(null);

    // Timer State
    const [elapsedTime, setElapsedTime] = useState('00:00');

    // Title Edit State
    const [isTitleEditDialogOpen, setIsTitleEditDialogOpen] = useState(false);
    const [newRoomTitle, setNewRoomTitle] = useState('');

    // Chat State
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [newChatMessage, setNewChatMessage] = useState('');
    const chatUnsubscribeRef = useRef<() => void | null>(null);
    const chatMessagesEndRef = useRef<HTMLDivElement>(null);


    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setCurrentUser(user);
                await fetchUserRelations(user.uid);
            } else {
                toast({ title: "Authentication Required", description: "You must be logged in to enter a room.", variant: "destructive" });
                router.push('/sound-sphere');
            }
        });
        
        const handleBeforeUnload = () => {
           if (cleanupRef.current) {
               // No-op. We want the audio to continue playing.
           }
        };
        
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
             unsubscribeAuth();
             window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [router, toast]);

    useEffect(() => {
        if (!room?.createdAt) return;

        const interval = setInterval(() => {
            const startTime = room.createdAt.toDate();
            const now = new Date();
            const diff = now.getTime() - startTime.getTime();

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            const paddedMinutes = minutes.toString().padStart(2, '0');
            const paddedSeconds = seconds.toString().padStart(2, '0');

            if (hours > 0) {
                const paddedHours = hours.toString().padStart(2, '0');
                setElapsedTime(`${paddedHours}:${paddedMinutes}:${paddedSeconds}`);
            } else {
                setElapsedTime(`${paddedMinutes}:${paddedSeconds}`);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [room?.createdAt]);
    
     const fetchUserRelations = async (userId: string) => {
        if (!db) return;
        const followingQuery = collection(db, "users", userId, "following");
        const blockedQuery = collection(db, "users", userId, "blocked");

        const [followingSnapshot, blockedSnapshot] = await Promise.all([
            getDocs(followingQuery),
            getDocs(blockedQuery)
        ]);

        setFollowingIds(followingSnapshot.docs.map(doc => doc.id));
        setBlockedIds(blockedSnapshot.docs.map(doc => doc.id));
    };

    // Main setup effect
    useEffect(() => {
        if (typeof window === 'undefined' || !currentUser || !roomId || !db) return;

        const myId = currentUser.uid;
        const myName = currentUser.displayName || 'Anonymous';
        
        let unsubParticipants: () => void = () => {};
        let unsubSignals: () => void = () => {};
        let unsubRoom: () => void = () => {};
        let unsubRequests: () => void = () => {};

        const cleanup = async () => {
            console.log(`[CLEANUP] Cleaning up for user ${myId} in room ${roomId}`);

            localStreamRef.current?.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
            
            Object.values(peersRef.current).forEach(peer => peer.destroy());
            peersRef.current = {};

            unsubParticipants();
            unsubSignals();
            unsubRoom();
            unsubRequests();
            
            if (!db) return;
            const participantRef = doc(db, "audioRooms", roomId, "participants", myId);
            const roomRef = doc(db, "audioRooms", roomId);

            try {
                const roomSnap = await getDoc(roomRef);
                if (roomSnap.exists()) {
                    await deleteDoc(participantRef);

                    const participantsCollectionRef = collection(roomRef, "participants");
                    const remainingParticipantsSnap = await getDocs(participantsCollectionRef);
                    if (remainingParticipantsSnap.size === 0) {
                        console.log(`[CLEANUP] Room ${roomId} is empty, deleting.`);
                        await deleteDoc(roomRef);
                    } else {
                        await updateDoc(roomRef, { participantsCount: remainingParticipantsSnap.size });
                    }
                }
            } catch (error) {
                 // Check if the error is due to the document not being found, which is okay if it was deleted by another client.
                if (error instanceof Error && (error as any).code !== 'not-found') {
                    console.error("[CLEANUP] Error during firestore cleanup: ", error);
                }
            }
        };

        cleanupRef.current = cleanup;

        const setupRoom = async () => {
            try {
                if (navigator.permissions) {
                    const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                    if (permissionStatus.state === 'denied') {
                        toast({
                            title: "Microphone Access Denied",
                            description: "Please enable microphone permissions in your browser settings to use audio rooms.",
                            variant: "destructive",
                            duration: 10000
                        });
                        router.push('/sound-sphere');
                        return;
                    }
                }
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                localStreamRef.current = stream;
                stream.getAudioTracks().forEach(track => track.enabled = false);
            } catch (err) {
                console.error("Error getting mic stream:", err);
                toast({ title: "Microphone Error", description: "Could not access your microphone. Please grant permission when prompted.", variant: "destructive" });
                router.push('/sound-sphere');
                return;
            }

            const roomDocRef = doc(db, "audioRooms", roomId);

            unsubRoom = onSnapshot(roomDocRef, (docSnap) => {
                if(!docSnap.exists()){
                     toast({ title: "Room Ended", description: "The creator has closed the room." });
                     router.push('/sound-sphere');
                     return;
                }
                const roomData = { id: docSnap.id, ...docSnap.data() } as Room
                setRoom(roomData);
                setNewRoomTitle(roomData.title);
                setPinnedLink(roomData.pinnedLink || null);

            }, (error) => {
                console.error("Error listening to room document:", error);
                router.push('/sound-sphere');
            });
            
            const initialRoomSnap = await getDoc(roomDocRef);
             if (!initialRoomSnap.exists()) {
                toast({ title: "Room not found", variant: "destructive" });
                router.push('/sound-sphere');
                return;
            }

            const roomData = initialRoomSnap.data() as Room;
            const isCreator = roomData.creatorId === myId;
            const persistedRoles = roomData.roles || {};
            const persistedRole = persistedRoles[myId]; // 'moderator' or 'speaker'

            const myRole = isCreator ? 'creator' : persistedRole || 'listener';

            const participantRef = doc(db, "audioRooms", roomId, "participants", myId);
            await setDoc(participantRef, {
                name: myName,
                avatar: currentUser.photoURL || `https://placehold.co/96x96.png`,
                isMuted: myRole === 'listener',
                role: myRole,
            });
            
            if (myRole !== 'listener' && localStreamRef.current) {
                localStreamRef.current.getAudioTracks().forEach(track => track.enabled = true);
                setIsMuted(false);
            }

            try {
                const currentParticipants = await getDocs(collection(roomDocRef, "participants"));
                await updateDoc(roomDocRef, { participantsCount: currentParticipants.size });
            } catch(e) {
                 if (e instanceof Error && (e as any).code !== 'not-found') {
                    console.warn("Could not update participant count, room may have been deleted.");
                 }
            }
            
            setIsLoading(false);

            const participantsColRef = collection(db, "audioRooms", roomId, "participants");
            unsubParticipants = onSnapshot(participantsColRef, snapshot => {
                let latestParticipants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Participant));
                
                if (blockedIds.length > 0) {
                    latestParticipants = latestParticipants.filter(p => !blockedIds.includes(p.id));
                }
                setParticipants(latestParticipants);

                const myData = latestParticipants.find(p => p.id === myId);
                if (myData && myData.role !== 'listener' && localStreamRef.current) {
                    const wasMuted = localStreamRef.current.getAudioTracks().every(t => !t.enabled);
                    if (wasMuted) {
                        localStreamRef.current.getAudioTracks().forEach(track => track.enabled = true);
                        setIsMuted(false);
                    }
                }

                if (!localStreamRef.current || localStreamRef.current.getAudioTracks().length === 0 || !localStreamRef.current.active) {
                    console.warn("[Peer Logic] Skipping peer connection logic: local stream not available or ready.");
                    return;
                }

                for (const participant of latestParticipants) {
                    if (participant.id !== myId && !peersRef.current[participant.id]) {
                         try {
                            const peer = new Peer({
                                initiator: myId > participant.id,
                                trickle: false,
                                stream: localStreamRef.current,
                                config: { iceServers }
                            });
                            
                            peer.on('signal', async (signalData) => {
                                try {
                                    await addDoc(collection(db, "audioRooms", roomId, "signals"), {
                                        to: participant.id, from: myId, fromName: myName, signal: JSON.stringify(signalData),
                                    });
                                } catch (error) {
                                    console.error(`Error sending signal to ${participant.id}`, error);
                                }
                            });
                            
                            peer.on('stream', (stream) => {
                                setRemoteStreams(prev => {
                                    if (prev.some(s => s.peerId === participant.id)) return prev;
                                    return [...prev, { peerId: participant.id, stream }];
                                });
                            });
                            
                            peer.on('error', (err) => {
                                console.error(`[PEER ERROR] to ${participant.id}:`, err);
                                if (peersRef.current[participant.id]) {
                                    peersRef.current[participant.id].destroy();
                                    delete peersRef.current[participant.id];
                                    setRemoteStreams(prev => prev.filter(s => s.peerId !== participant.id));
                                }
                            });
                            
                            peer.on('close', () => {
                                setRemoteStreams(prev => prev.filter(s => s.peerId !== participant.id));
                                if (peersRef.current[participant.id]) delete peersRef.current[participant.id];
                            });

                            peersRef.current[participant.id] = peer;
                        } catch (err) {
                            console.error("Error creating peer:", err);
                        }
                    }
                }
                const existingPeerIds = Object.keys(peersRef.current);
                const latestParticipantIds = latestParticipants.map(p => p.id);
                for (const peerId of existingPeerIds) {
                    if (!latestParticipantIds.includes(peerId)) {
                        if (peersRef.current[peerId]) {
                            peersRef.current[peerId].destroy();
                            delete peersRef.current[peerId];
                        }
                        setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
                    }
                }
            });

            const signalsQuery = query(collection(db, "audioRooms", roomId, "signals"), where("to", "==", myId));
            unsubSignals = onSnapshot(signalsQuery, (snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        const data = change.doc.data();
                        const fromId = data.from;
                        const peer = peersRef.current[fromId];
                         try {
                            if (peer && !peer.destroyed) {
                                peer.signal(JSON.parse(data.signal));
                            }
                            await deleteDoc(change.doc.ref);
                        } catch (err) {
                            console.error(`Error processing signal from ${fromId}:`, err);
                        }
                    }
                });
            });

            if (isCreator) {
                const requestsRef = collection(db, "audioRooms", roomId, "requests");
                unsubRequests = onSnapshot(requestsRef, snapshot => {
                    setSpeakingRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SpeakRequest)));
                });
            }

            const requestDoc = await getDoc(doc(db, "audioRooms", roomId, "requests", myId));
            if (requestDoc.exists()) {
                setHasRequested(true);
            }
        };

        setupRoom();

        return () => {
            if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = undefined;
            }
        };

    }, [currentUser, roomId, db, router, toast]);

    useEffect(() => {
        if (!selectedUser || !db) {
            setProfileStats(null);
            return;
        }

        const fetchStats = async () => {
            setIsStatsLoading(true);
            try {
                const userId = selectedUser.id;
                const [postsSnap, followersSnap, followingSnap] = await Promise.all([
                    getDocs(query(collection(db, "posts"), where("authorId", "==", userId))),
                    getDocs(collection(db, "users", userId, "followers")),
                    getDocs(collection(db, "users", userId, "following"))
                ]);
                
                setProfileStats({
                    posts: postsSnap.size,
                    followers: followersSnap.size,
                    following: followingSnap.size,
                });
            } catch (error) {
                console.error("Error fetching profile stats:", error);
                toast({ title: "Error", description: "Could not load user stats.", variant: "destructive" });
                setProfileStats(null);
            } finally {
                setIsStatsLoading(false);
            }
        };

        fetchStats();
    }, [selectedUser, db, toast]);

    useEffect(() => {
        if (!isChatOpen || !roomId || !db) {
            if (chatUnsubscribeRef.current) {
                chatUnsubscribeRef.current();
                chatUnsubscribeRef.current = null;
            }
            return;
        }
        const messagesRef = collection(db, "audioRooms", roomId, "chatMessages");
        const q = query(messagesRef, orderBy("createdAt", "asc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setChatMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ChatMessage));
        });
        chatUnsubscribeRef.current = unsubscribe;

        return () => {
            if (chatUnsubscribeRef.current) {
                chatUnsubscribeRef.current();
            }
        }
    }, [isChatOpen, roomId, db]);

    useEffect(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages]);
    
    // Effect to set up the Picture-in-Picture canvas and stream
    useEffect(() => {
        const videoEl = pipVideoRef.current;
        const canvasEl = pipCanvasRef.current;
        if (!videoEl || !canvasEl || !room) return;

        // Draw on the canvas
        const ctx = canvasEl.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#111827'; // bg-gray-900
            ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
            ctx.fillStyle = 'white';
            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(room.title, canvasEl.width / 2, canvasEl.height / 2);
            ctx.font = '14px sans-serif';
            ctx.fillStyle = '#9CA3AF'; // text-gray-400
            ctx.fillText('Listening in Sound Sphere...', canvasEl.width / 2, canvasEl.height / 2 + 25);
        }

        // Combine streams for PiP
        const canvasStream = canvasEl.captureStream();
        const videoTrack = canvasStream.getVideoTracks()[0];
        
        const combinedStream = new MediaStream([videoTrack]);
        remoteStreams.forEach(remote => {
            remote.stream.getAudioTracks().forEach(track => {
                combinedStream.addTrack(track.clone());
            });
        });

        videoEl.srcObject = combinedStream;
        videoEl.play().catch(e => console.error("PiP Video play error", e));

    }, [remoteStreams, room]);


    const handleLeaveRoom = async () => {
        if (document.pictureInPictureElement) {
            try {
                await document.exitPictureInPicture();
            } catch (error) {
                console.error("Error exiting PiP on leave:", error);
            }
        }
        router.push('/sound-sphere?tab=rooms'); 
    };

    const handleEndRoom = async () => {
        if (!db || !currentUser || room?.creatorId !== currentUser.uid) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            }
            await deleteDoc(doc(db, "audioRooms", roomId));
        } catch(error) {
            console.error("Error ending room:", error);
            toast({ title: "Error", description: "Could not end room.", variant: "destructive" });
        } finally {
            router.push('/sound-sphere');
        }
    };


    const handleMuteToggle = async () => {
        if (!localStreamRef.current || !currentUser || !db) return;
        const myData = participants.find(p => p.id === currentUser.uid);
        if (myData?.role === 'listener') return;

        const newMutedState = !isMuted;
        localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !newMutedState);
        setIsMuted(newMutedState);

        const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        try {
            await updateDoc(participantRef, { isMuted: newMutedState });
        } catch (error) {
            if (error instanceof Error && (error as any).code !== 'not-found') {
                 toast({ title: "Error", description: "Could not sync mute state.", variant: "destructive" });
            }
        }
    };
    
    const handleRequestToSpeak = async () => {
        if (!currentUser || !db) return;
        const requestRef = doc(db, "audioRooms", roomId, "requests", currentUser.uid);
        try {
            await setDoc(requestRef, {
                name: currentUser.displayName,
                avatar: currentUser.photoURL,
            });
            setHasRequested(true);
            toast({ title: "Request Sent", description: "The room creator has been notified." });
        } catch (error) {
            console.error("Error requesting to speak:", error);
            toast({ title: "Error", description: "Could not send your request.", variant: "destructive" });
        }
    };
    
    const handleManageRequest = async (requesterId: string, accept: boolean) => {
        if (!db) return;
        const requestRef = doc(db, "audioRooms", roomId, "requests", requesterId);
        if (accept) {
            await handleChangeRole(requesterId, 'speaker');
        }
        await deleteDoc(requestRef);
    };

    const handleFollowToggle = async () => {
        if (!db || !currentUser || !selectedUser) return;
        
        const followingRef = doc(db, "users", currentUser.uid, "following", selectedUser.id);
        const followerRef = doc(db, "users", selectedUser.id, "followers", currentUser.uid);

        try {
            if (followingIds.includes(selectedUser.id)) {
                await deleteDoc(followingRef);
                await deleteDoc(followerRef);
                setFollowingIds(prev => prev.filter(id => id !== selectedUser.id));
                toast({ title: "Unfollowed" });
            } else {
                await setDoc(followingRef, { since: serverTimestamp() });
                await setDoc(followerRef, { by: currentUser.displayName || 'Anonymous', at: serverTimestamp() });
                setFollowingIds(prev => [...prev, selectedUser.id]);
                toast({ title: "Followed" });
                 if (currentUser.uid !== selectedUser.id) {
                    await addDoc(collection(db, "notifications"), {
                        recipientId: selectedUser.id,
                        actorId: currentUser.uid,
                        actorName: currentUser.displayName || 'Someone',
                        type: 'follow',
                        entityId: currentUser.uid,
                        read: false,
                        createdAt: serverTimestamp(),
                    });
                }
            }
        } catch (error) {
            console.error("Error following user:", error);
            toast({ title: "Error", description: "Could not perform action.", variant: "destructive" });
        }
    };

    const handleMessageClick = () => {
        if (!selectedUser) return;
        window.dispatchEvent(new CustomEvent('open-chat', { detail: { userId: selectedUser.id } }));
        setSelectedUser(null);
    };
    
    const handleBlockUser = async () => {
        if (!db || !currentUser || !selectedUser) return;
        
        const blockRef = doc(db, "users", currentUser.uid, "blocked", selectedUser.id);
        try {
            await setDoc(blockRef, { blockedAt: serverTimestamp() });
            toast({ title: "User Blocked", description: `${selectedUser.name} has been blocked.` });
            setBlockedIds(prev => [...prev, selectedUser.id]);
            setParticipants(prev => prev.filter(p => p.id !== selectedUser.id));
            setSelectedUser(null);
        } catch (error) {
            console.error("Error blocking user:", error);
            toast({ title: "Error", description: "Could not block user.", variant: "destructive" });
        }
    };

    const handlePinLink = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !linkToPin.trim()) return;
        try {
            const roomRef = doc(db, "audioRooms", roomId);
            await updateDoc(roomRef, { pinnedLink: linkToPin });
            toast({ title: "Link Pinned" });
            setIsPinLinkDialogOpen(false);
            setLinkToPin('');
        } catch (error) {
            if (error instanceof Error && (error as any).code !== 'not-found') {
                console.error("Error pinning link:", error);
                toast({ title: "Error", description: "Could not pin the link.", variant: "destructive" });
            }
        }
    };
    
    const handleUnpinLink = async () => {
        if (!db) return;
        try {
            const roomRef = doc(db, "audioRooms", roomId);
            await updateDoc(roomRef, { pinnedLink: '' });
            toast({ title: "Link Unpinned" });
        } catch (error) {
            if (error instanceof Error && (error as any).code !== 'not-found') {
                console.error("Error unpinning link:", error);
                toast({ title: "Error", description: "Could not unpin the link.", variant: "destructive" });
            }
        }
    };
    
    const handleEnterPip = useCallback(async () => {
        const video = pipVideoRef.current;
        if (!video) {
            toast({ title: "Error", description: "PiP video element not ready.", variant: "destructive" });
            return;
        }
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else {
            try {
                if (video.readyState >= 1) { // HAVE_METADATA or more
                    await video.requestPictureInPicture();
                } else {
                    toast({ title: "Error", description: "Video stream not ready for PiP.", variant: "destructive" });
                }
            } catch (error) {
                console.error("Error entering PiP:", error);
                toast({ title: "PiP Error", description: "Could not enter Picture-in-Picture mode. This may require a direct user click.", variant: "destructive" });
            }
        }
    }, [toast]);

    // Automatically enter PiP when tab is hidden
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && !document.pictureInPictureElement && pipVideoRef.current) {
                handleEnterPip();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [handleEnterPip]);
    
    const handleTitleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !newRoomTitle.trim() || !isModerator) return;
        try {
            const roomRef = doc(db, "audioRooms", roomId);
            await updateDoc(roomRef, { title: newRoomTitle });
            toast({ title: "Room title updated" });
            setIsTitleEditDialogOpen(false);
        } catch (error) {
            console.error("Error updating title:", error);
            toast({ title: "Error", description: "Could not update room title.", variant: "destructive" });
        }
    };
    
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser || !newChatMessage.trim()) return;

        const messagesColRef = collection(db, "audioRooms", roomId, "chatMessages");
        try {
            await addDoc(messagesColRef, {
                text: newChatMessage,
                senderId: currentUser.uid,
                senderName: currentUser.displayName,
                senderAvatar: currentUser.photoURL,
                createdAt: serverTimestamp(),
            });
            setNewChatMessage('');
        } catch (error) {
            console.error("Error sending chat message:", error);
            toast({ title: "Error", description: "Could not send message.", variant: "destructive" });
        }
    };

    const handleChangeRole = async (targetId: string, newRole: 'moderator' | 'speaker' | 'listener') => {
        if (!db || !isModerator) return;

        const roomRef = doc(db, "audioRooms", roomId);
        const participantRef = doc(db, "audioRooms", roomId, "participants", targetId);

        try {
            const batch = writeBatch(db);

            batch.update(participantRef, { role: newRole, isMuted: newRole === 'listener' });

            if (newRole === 'listener') {
                batch.update(roomRef, { [`roles.${targetId}`]: deleteField() });
            } else {
                batch.update(roomRef, { [`roles.${targetId}`]: newRole });
            }

            await batch.commit();
            toast({ title: "Role Updated" });
            setSelectedUser(null);
        } catch (error) {
            console.error("Error changing role:", error);
            toast({ title: "Error", description: "Could not update user role.", variant: "destructive" });
        }
    };


    if (isLoading || !room || !currentUser) {
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
                    if (p.id !== currentUser.uid) {
                        setSelectedUser(p);
                    }
                }}
                disabled={p.id === currentUser.uid}
                className="relative flex flex-col items-center gap-2 cursor-pointer transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-70"
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
        <SubpageLayout title={room.title} backHref="/sound-sphere?tab=rooms" showTitle={false}>
            {remoteStreams.map(remote => <AudioPlayer key={remote.peerId} stream={remote.stream} />)}
            
            <div className="absolute -z-10 opacity-0 pointer-events-none">
              <canvas ref={pipCanvasRef} width="320" height="180"></canvas>
              <video ref={pipVideoRef} muted playsInline></video>
            </div>

            <div className="mx-auto max-w-4xl space-y-8">
                 <div className="text-left space-y-2">
                    <div className="flex items-center gap-2">
                        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl font-headline">{room.title}</h1>
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
                    <p className="text-lg text-muted-foreground">{room.description}</p>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <TimerIcon className="h-4 w-4" />
                        <p className="text-sm font-mono">{elapsedTime}</p>
                    </div>
                </div>
                {pinnedLink && (
                     <Card>
                        <CardContent className="p-3 flex items-center justify-between">
                             <div className="flex items-center gap-3">
                                 <LinkIcon className="h-5 w-5 text-primary"/>
                                 <a href={pinnedLink} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline truncate">
                                     {pinnedLink}
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
                                        <DropdownMenuItem onClick={handleUnpinLink}>
                                            <X className="mr-2 h-4 w-4"/> Unpin Link
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                             )}
                        </CardContent>
                    </Card>
                )}
                 {isCreator && speakingRequests.length > 0 && (
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
                                        <Button size="icon" variant="outline" className="bg-red-500/20 text-red-700 hover:bg-red-500/30" onClick={() => handleManageRequest(req.id, false)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                         <Button size="icon" variant="outline" className="bg-green-500/20 text-green-700 hover:bg-green-500/30" onClick={() => handleManageRequest(req.id, true)}>
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
                                        <Button variant="outline" onClick={handleMessageClick}>
                                            <MessageSquare className="mr-2 h-4 w-4" /> Message
                                        </Button>
                                        <Button variant="destructive" onClick={handleBlockUser}>
                                            <UserX className="mr-2 h-4 w-4" /> Block
                                        </Button>
                                    </div>
                                    {canManageSelectedUser && selectedUser.role !== 'creator' && <div className="border-t pt-4 space-y-2">
                                        <p className="text-sm font-medium text-center">Moderator Actions</p>
                                        <div className="flex justify-center gap-2">
                                            {selectedUser.role === 'listener' && <Button size="sm" onClick={() => handleChangeRole(selectedUser.id, 'speaker')}>Invite to Speak</Button>}
                                            {selectedUser.role === 'speaker' && (
                                                <>
                                                    <Button size="sm" onClick={() => handleChangeRole(selectedUser.id, 'moderator')}>Make Moderator</Button>
                                                    <Button size="sm" variant="outline" onClick={() => handleChangeRole(selectedUser.id, 'listener')}>Move to Listeners</Button>
                                                </>
                                            )}
                                            {selectedUser.role === 'moderator' && (
                                                <>
                                                    <Button size="sm" onClick={() => handleChangeRole(selectedUser.id, 'speaker')}>Demote to Speaker</Button>
                                                    <Button size="sm" variant="outline" onClick={() => handleChangeRole(selectedUser.id, 'listener')}>Move to Listeners</Button>
                                                </>
                                            )}
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
                            onClick={handleMuteToggle}
                            disabled={!localStreamRef.current}
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
                            onClick={handleRequestToSpeak}
                            disabled={hasRequested}
                            variant="outline"
                         >
                            <Hand className="mr-2 h-5 w-5" />
                            {hasRequested ? 'Request Sent' : 'Request to Speak'}
                         </Button>
                     )}
                    <Button variant="outline" onClick={handleEnterPip} className="sm:w-auto w-full">
                        <PictureInPicture className="mr-2 h-5 w-5" />
                        PiP
                    </Button>
                    <Button variant="outline" onClick={handleLeaveRoom} className="sm:w-auto w-full">
                        <LogOut className="mr-2 h-5 w-5" />
                        Leave
                    </Button>
                    {isCreator && (
                        <Button variant="destructive" onClick={handleEndRoom} className="sm:w-auto w-full">
                            <XCircle className="mr-2 h-5 w-5" />
                            End Room
                        </Button>
                    )}
                </div>
            </div>
        </SubpageLayout>
    );
}
