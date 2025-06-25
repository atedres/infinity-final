
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from '@/hooks/use-toast';
import { db, auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, updateDoc, getDocs, query, where, addDoc, serverTimestamp } from 'firebase/firestore';
import { Mic, MicOff, LogOut, XCircle, Hand, Check, X, Users, Headphones, UserPlus, UserCheck, MessageSquare, UserX, Link as LinkIcon, MoreVertical, PictureInPicture } from 'lucide-react';
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
    roles?: { [key: string]: 'speaker' };
}

interface Participant {
    id: string;
    name: string;
    avatar: string;
    isMuted: boolean;
    role: 'creator' | 'speaker' | 'listener';
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
               cleanupRef.current();
           }
        };
        
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
             unsubscribeAuth();
             window.removeEventListener('beforeunload', handleBeforeUnload);
             if (cleanupRef.current) {
               cleanupRef.current();
             }
        };
    }, [router, toast]);
    
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
                // Only perform deletions if the room still exists
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
            const isPersistedSpeaker = persistedRoles[myId] === 'speaker';

            const myRole = isCreator ? 'creator' : isPersistedSpeaker ? 'speaker' : 'listener';

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

                // Wait until local stream is confirmed to be ready.
                if (!localStreamRef.current || localStreamRef.current.getAudioTracks().length === 0) {
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


    const handleLeaveRoom = () => {
        router.push('/sound-sphere?tab=rooms'); 
    };

    const handleEndRoom = async () => {
        if (!db || !currentUser || room?.creatorId !== currentUser.uid) return;
        try {
            await deleteDoc(doc(db, "audioRooms", roomId));
        } catch(error) {
            console.error("Error ending room:", error);
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
            const participantRef = doc(db, "audioRooms", roomId, "participants", requesterId);
            const roomRef = doc(db, "audioRooms", roomId);
            try {
                await updateDoc(roomRef, {
                    [`roles.${requesterId}`]: 'speaker'
                });
                await updateDoc(participantRef, { role: 'speaker', isMuted: false });
            } catch(e) {
                console.warn("Participant may have left before being accepted.");
            }
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


    if (isLoading || !room || !currentUser) {
        return <SubpageLayout title="Sound Sphere Room" backHref="/sound-sphere?tab=rooms"><div className="text-center">Loading room...</div></SubpageLayout>;
    }

    const isCreator = currentUser?.uid === room.creatorId;
    const myParticipantData = participants.find(p => p.id === currentUser.uid);
    const myRole = myParticipantData?.role;
    const canSpeak = myRole === 'creator' || myRole === 'speaker';
    const isFollowingSelected = selectedUser && followingIds.includes(selectedUser.id);
    
    const speakers = participants.filter(p => p.role === 'creator' || p.role === 'speaker');
    const listeners = participants.filter(p => p.role === 'listener');
    
    const renderParticipant = (p: Participant) => {
        const isUnmutedSpeaker = (p.role === 'creator' || p.role === 'speaker') && !p.isMuted;
        
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
                <Avatar className={cn(
                    'h-20 w-20 border-4',
                    isUnmutedSpeaker ? 'border-green-500' : 'border-transparent'
                )}>
                    <AvatarImage src={p.avatar} data-ai-hint="person portrait"/>
                    <AvatarFallback>{p.name?.[0]}</AvatarFallback>
                </Avatar>
                {(p.isMuted || p.role === 'listener') && (
                    <div className="absolute top-1 right-1 bg-slate-700 rounded-full p-1 border-2 border-background">
                        <MicOff className="h-3 w-3 text-slate-100" />
                    </div>
                )}
                <p className="font-medium text-sm truncate w-full text-center">{p.name}</p>
            </button>
        );
    };

    return (
        <SubpageLayout title={room.title} backHref="/sound-sphere?tab=rooms" showTitle={false}>
            {remoteStreams.map(remote => <AudioPlayer key={remote.peerId} stream={remote.stream} />)}
            
            <div className="absolute -z-10 opacity-0 pointer-events-none">
              <canvas ref={pipCanvasRef} width="320" height="180"></canvas>
              <video ref={pipVideoRef} muted playsInline></video>
            </div>

            <div className="mx-auto max-w-4xl space-y-8">
                 <div className="text-left">
                    <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl font-headline">{room.title}</h1>
                    <p className="mt-2 text-lg text-muted-foreground">{room.description}</p>
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
                            <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
                                {speakers.map(renderParticipant)}
                                 {speakers.length === 0 && <p className="text-muted-foreground col-span-full text-center">No speakers yet.</p>}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center gap-2">
                                <Headphones className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Listeners ({listeners.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
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
                                <div className="flex justify-center gap-2 pt-4">
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

                <div className="flex justify-center gap-4">
                     {canSpeak ? (
                        <>
                        <Button
                            variant={isMuted ? 'secondary' : 'outline'}
                            size="lg"
                            onClick={handleMuteToggle}
                            disabled={!localStreamRef.current}
                            className="w-28"
                        >
                            {isMuted ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                            {isMuted ? 'Unmute' : 'Mute'}
                        </Button>
                        <Button variant="outline" size="lg" onClick={() => setIsPinLinkDialogOpen(true)}>
                            <LinkIcon className="mr-2 h-5 w-5" />
                            Pin Link
                        </Button>
                        </>
                     ) : (
                         <Button
                            size="lg"
                            onClick={handleRequestToSpeak}
                            disabled={hasRequested}
                            variant="outline"
                         >
                            <Hand className="mr-2 h-5 w-5" />
                            {hasRequested ? 'Request Sent' : 'Request to Speak'}
                         </Button>
                     )}
                    <Button variant="outline" size="lg" onClick={handleEnterPip}>
                        <PictureInPicture className="mr-2 h-5 w-5" />
                        PiP
                    </Button>
                    <Button variant="outline" size="lg" onClick={handleLeaveRoom}>
                        <LogOut className="mr-2 h-5 w-5" />
                        Leave
                    </Button>
                    {isCreator && (
                        <Button variant="destructive" size="lg" onClick={handleEndRoom}>
                            <XCircle className="mr-2 h-5 w-5" />
                            End Room
                        </Button>
                    )}
                </div>
            </div>
        </SubpageLayout>
    );
}
