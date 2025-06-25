
"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { db, auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, updateDoc, getDocs, query, where, addDoc } from 'firebase/firestore';
import { Mic, MicOff, LogOut, XCircle, Hand, Check, X, Users, Headphones } from 'lucide-react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';
import 'webrtc-adapter';


interface Room {
    id: string;
    title: string;
    description: string;
    creatorId: string;
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

    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, user => {
            if (user) {
                setCurrentUser(user);
            } else {
                toast({ title: "Authentication Required", description: "You must be logged in to enter a room.", variant: "destructive" });
                router.push('/sound-sphere');
            }
        });
        return () => unsubscribeAuth();
    }, [router, toast]);
    
    // Main setup effect
    useEffect(() => {
        if (!currentUser || !roomId || !db) return;

        const myId = currentUser.uid;
        const myName = currentUser.displayName || 'Anonymous';
        
        let unsubParticipants: () => void = () => {};
        let unsubSignals: () => void = () => {};
        let unsubRoom: () => void = () => {};
        let unsubRequests: () => void = () => {};

        const cleanup = async () => {
            console.log(`[CLEANUP] Cleaning up for user ${myId}`);

            localStreamRef.current?.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
            
            Object.values(peersRef.current).forEach(peer => peer.destroy());
            peersRef.current = {};

            unsubParticipants();
            unsubSignals();
            unsubRoom();
            unsubRequests();

            const roomRef = doc(db, "audioRooms", roomId);

            try {
                const currentRoomDoc = await getDoc(roomRef);
                if (currentRoomDoc.exists()) {
                    const participantRef = doc(db, "audioRooms", roomId, "participants", myId);
                    const participantSnap = await getDoc(participantRef);

                    if (participantSnap.exists()) {
                        if (currentRoomDoc.data().creatorId === myId) {
                            console.log(`[CLEANUP] Creator is ending the room.`);
                             // Deleting the room doc will trigger other users to leave
                            await deleteDoc(roomRef);
                        } else {
                            await deleteDoc(participantRef);
                             const remainingParticipantsSnap = await getDocs(collection(roomRef, "participants"));
                            if (remainingParticipantsSnap.size === 0) {
                                await deleteDoc(roomRef);
                            } else {
                                await updateDoc(roomRef, { participantsCount: remainingParticipantsSnap.size });
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("[CLEANUP] Error during firestore cleanup: ", error);
            }
        };

        const setupRoom = async () => {
            // 1. Get Mic stream
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                localStreamRef.current = stream;
                // Start with mic disabled for everyone initially
                stream.getAudioTracks().forEach(track => track.enabled = false);
            } catch (err) {
                console.error("Error getting mic stream:", err);
                toast({ title: "Microphone Error", description: "Could not access your microphone.", variant: "destructive" });
                router.push('/sound-sphere');
                return;
            }

            // 2. Get room info and join
            const roomDocRef = doc(db, "audioRooms", roomId);
            const roomSnap = await getDoc(roomDocRef);
            if (!roomSnap.exists()) {
                toast({ title: "Room not found", variant: "destructive" });
                router.push('/sound-sphere');
                return;
            }
            const roomData = { id: roomSnap.id, ...roomSnap.data() } as Room
            setRoom(roomData);

            unsubRoom = onSnapshot(roomDocRef, (doc) => {
                if(!doc.exists()){
                     toast({ title: "Room Ended", description: "The creator has closed the room." });
                     router.push('/sound-sphere');
                }
            });

            const isCreator = roomData.creatorId === myId;
            const myRole = isCreator ? 'creator' : 'listener';

            const participantRef = doc(db, "audioRooms", roomId, "participants", myId);
            await setDoc(participantRef, {
                name: myName,
                avatar: currentUser.photoURL || `https://placehold.co/96x96.png`,
                isMuted: true,
                role: myRole,
            });
            
            if (isCreator && localStreamRef.current) {
                localStreamRef.current.getAudioTracks().forEach(track => track.enabled = true);
                setIsMuted(false);
            }

            const currentParticipants = await getDocs(collection(roomDocRef, "participants"));
            await updateDoc(roomDocRef, { participantsCount: currentParticipants.size });
            
            setIsLoading(false);

            // 3. Set up participant listener
            const participantsColRef = collection(db, "audioRooms", roomId, "participants");
            unsubParticipants = onSnapshot(participantsColRef, snapshot => {
                const latestParticipants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Participant));
                setParticipants(latestParticipants);

                const myData = latestParticipants.find(p => p.id === myId);
                if (myData?.role !== 'listener' && localStreamRef.current) {
                    const wasMuted = localStreamRef.current.getAudioTracks().every(t => !t.enabled);
                    if (wasMuted) {
                        localStreamRef.current.getAudioTracks().forEach(track => track.enabled = true);
                        setIsMuted(false);
                    }
                }

                // Peer connection logic...
                const existingPeerIds = Object.keys(peersRef.current);
                const latestParticipantIds = latestParticipants.map(p => p.id);

                for (const participant of latestParticipants) {
                    if (participant.id !== myId && !peersRef.current[participant.id]) {
                        const peer = new Peer({
                             initiator: myId > participant.id,
                             trickle: false,
                             stream: localStreamRef.current!,
                             config: { iceServers }
                        });
                        
                        peer.on('signal', async (signalData) => {
                            await addDoc(collection(db, "audioRooms", roomId, "signals"), {
                                to: participant.id, from: myId, fromName: myName, signal: JSON.stringify(signalData),
                            });
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
                    }
                }
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

            // 4. Set up signal listener
            const signalsQuery = query(collection(db, "audioRooms", roomId, "signals"), where("to", "==", myId));
            unsubSignals = onSnapshot(signalsQuery, (snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        const data = change.doc.data();
                        const fromId = data.from;
                        const peer = peersRef.current[fromId];
                        if (peer && !peer.destroyed) {
                             peer.signal(JSON.parse(data.signal));
                        }
                        await deleteDoc(change.doc.ref);
                    }
                });
            });

            // 5. Set up requests listener for creator
            if (isCreator) {
                const requestsRef = collection(db, "audioRooms", roomId, "requests");
                unsubRequests = onSnapshot(requestsRef, snapshot => {
                    setSpeakingRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SpeakRequest)));
                });
            }

            // 6. Check if I already have a pending request
            const requestDoc = await getDoc(doc(db, "audioRooms", roomId, "requests", myId));
            if (requestDoc.exists()) {
                setHasRequested(true);
            }
        };

        setupRoom();

        // Master cleanup function when component unmounts or dependencies change
        return () => {
            cleanup();
        };

    }, [currentUser, roomId, db, router, toast]);

    const handleLeaveRoom = () => {
        router.push('/sound-sphere'); 
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
            console.error("Error updating mute state:", error);
            toast({ title: "Error", description: "Could not sync mute state.", variant: "destructive" });
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
            await updateDoc(participantRef, { role: 'speaker', isMuted: false });
        }
        await deleteDoc(requestRef);
    };

    if (isLoading || !room || !currentUser) {
        return <SubpageLayout title="Sound Sphere Room"><div className="text-center">Loading room...</div></SubpageLayout>;
    }

    const isCreator = currentUser?.uid === room.creatorId;
    const myParticipantData = participants.find(p => p.id === currentUser.uid);
    const myRole = myParticipantData?.role;

    const canSpeak = myRole === 'creator' || myRole === 'speaker';
    
    const speakers = participants.filter(p => p.role === 'creator' || p.role === 'speaker');
    const listeners = participants.filter(p => p.role === 'listener');

    return (
        <SubpageLayout title={room.title}>
            {remoteStreams.map(remote => <AudioPlayer key={remote.peerId} stream={remote.stream} />)}
            <div className="mx-auto max-w-4xl text-center space-y-8">
                <p className="text-muted-foreground">{room.description}</p>
                
                 {isCreator && speakingRequests.length > 0 && (
                     <Card className="border-primary">
                        <CardHeader>
                            <CardTitle>Speaking Requests</CardTitle>
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

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <Mic className="h-5 w-5 text-primary" />
                        <CardTitle>Speakers ({speakers.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
                        {speakers.map(p => (
                            <div key={p.id} className="relative flex flex-col items-center gap-2">
                                 <Avatar className={`h-20 w-20 border-4 ${!p.isMuted ? 'border-green-500 animate-pulse' : 'border-transparent'}`}>
                                    <AvatarImage src={p.avatar} data-ai-hint="person portrait"/>
                                    <AvatarFallback>{p.name?.[0]}</AvatarFallback>
                                </Avatar>
                                {p.isMuted && (
                                    <div className="absolute top-1 right-1 bg-slate-700 rounded-full p-1 border-2 border-background">
                                        <MicOff className="h-3 w-3 text-slate-100" />
                                    </div>
                                )}
                                <p className="font-medium text-sm truncate w-full">{p.name}</p>
                            </div>
                        ))}
                         {speakers.length === 0 && <p className="text-muted-foreground col-span-full text-center">No speakers yet.</p>}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <Headphones className="h-5 w-5 text-muted-foreground" />
                        <CardTitle>Listeners ({listeners.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
                        {listeners.map(p => (
                            <div key={p.id} className="relative flex flex-col items-center gap-2">
                                 <Avatar className="h-20 w-20">
                                    <AvatarImage src={p.avatar} data-ai-hint="person portrait"/>
                                    <AvatarFallback>{p.name?.[0]}</AvatarFallback>
                                </Avatar>
                                 <div className="absolute top-1 right-1 bg-slate-700 rounded-full p-1 border-2 border-background">
                                    <MicOff className="h-3 w-3 text-slate-100" />
                                </div>
                                <p className="font-medium text-sm truncate w-full">{p.name}</p>
                            </div>
                        ))}
                        {listeners.length === 0 && <p className="text-muted-foreground col-span-full text-center">No listeners yet.</p>}
                    </CardContent>
                </Card>

                <div className="flex justify-center gap-4">
                     {canSpeak ? (
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
                    <Button variant="outline" size="lg" onClick={handleLeaveRoom}>
                        <LogOut className="mr-2 h-5 w-5" />
                        Leave
                    </Button>
                    {isCreator && (
                        <Button variant="destructive" size="lg" onClick={handleLeaveRoom}>
                            <XCircle className="mr-2 h-5 w-5" />
                            End Room
                        </Button>
                    )}
                </div>
            </div>
        </SubpageLayout>
    );
}

