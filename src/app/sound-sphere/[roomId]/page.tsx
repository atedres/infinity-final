
"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { db, auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, updateDoc, increment, query, where, addDoc } from 'firebase/firestore';
import { Mic, MicOff, LogOut, XCircle } from 'lucide-react';
import Peer from 'simple-peer';
import type { Instance as PeerInstance, SignalData } from 'simple-peer';
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


export default function AudioRoomPage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const roomId = params.roomId as string;

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    
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
    

    function setupPeerListeners(peer: PeerInstance, peerId: string, peerName: string) {
        peer.on('stream', (stream) => {
             console.log(`[STREAM] Received stream from ${peerName} (${peerId})`);
             setRemoteStreams(prev => {
                if (prev.some(s => s.peerId === peerId)) return prev;
                return [...prev, { peerId: peerId, stream }];
             });
        });
        
        peer.on('error', (err) => {
            console.error(`[PEER ERROR] with ${peerName} (${peerId}):`, err);
            toast({variant: 'destructive', title: `Connection to ${peerName} failed`, description: err.message})
            if (peersRef.current[peerId]) {
                peersRef.current[peerId].destroy();
                delete peersRef.current[peerId];
            }
            setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
        });

        peer.on('connect', () => {
            console.log(`[CONNECTED] to ${peerName} (${peerId})!`);
        });
        
        peer.on('close', () => {
             console.log(`[CLOSED] Connection to ${peerName} (${peerId})`);
             setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
             if (peersRef.current[peerId]) {
                delete peersRef.current[peerId];
             }
        });
    }

    const handleLeaveRoom = async (isCreator = false) => {
        if (!db || !currentUser || !roomId) return;
        
        console.log(`[LEAVE] User ${currentUser.uid} leaving room.`);

        // Destroy all peer connections
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};
        
        // Stop local media tracks
        localAudioStream?.getTracks().forEach(track => track.stop());

        const roomRef = doc(db, "audioRooms", roomId);

        try {
            if (isCreator) {
                console.log(`[LEAVE] Creator is ending the room.`);
                await deleteDoc(roomRef);
            } else {
                const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
                const currentRoomDoc = await getDoc(roomRef);
                if(currentRoomDoc.exists()){
                    const participantsSnap = await getDocs(collection(roomRef, "participants"));
                    if (participantsSnap.size <= 1) {
                         console.log(`[LEAVE] Last participant is leaving, deleting room.`);
                        await deleteDoc(roomRef); 
                    } else {
                        console.log(`[LEAVE] Removing participant from room.`);
                        await deleteDoc(participantRef);
                        await updateDoc(roomRef, { participantsCount: increment(-1) });
                    }
                }
            }
        } catch (error) {
            console.error("Error during firestore cleanup: ", error);
        } finally {
            router.push('/sound-sphere');
        }
    };
    
    // Main setup effect
    useEffect(() => {
        if (!currentUser || !roomId || !db) return;

        const myId = currentUser.uid;
        let stream: MediaStream;
        
        // Unsubscribe functions
        let unsubParticipants: () => void = () => {};
        let unsubSignals: () => void = () => {};
        let unsubRoom: () => void = () => {};

        const setupRoom = async () => {
            // 1. Get Mic stream
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                setLocalAudioStream(stream);
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
            setRoom({ id: roomSnap.id, ...roomSnap.data() } as Room);

            unsubRoom = onSnapshot(roomDocRef, (doc) => {
                if(!doc.exists()){
                     toast({ title: "Room Ended", description: "The creator has closed the room." });
                     router.push('/sound-sphere');
                }
            });

            const participantRef = doc(db, "audioRooms", roomId, "participants", myId);
            await setDoc(participantRef, {
                name: currentUser.displayName || 'Anonymous',
                avatar: currentUser.photoURL || `https://placehold.co/96x96.png`,
                isMuted: false,
            });
            setIsLoading(false);


            // 3. Set up participant listener
            const participantsColRef = collection(db, "audioRooms", roomId, "participants");
            unsubParticipants = onSnapshot(participantsColRef, snapshot => {
                const updatedParticipants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Participant));
                setParticipants(updatedParticipants);

                const currentPeerIds = Object.keys(peersRef.current);
                const newParticipantIds = updatedParticipants.map(p => p.id);

                // Connect to new participants
                updatedParticipants.forEach(participant => {
                    if (participant.id !== myId && !peersRef.current[participant.id]) {
                        console.log(`[SETUP] Creating peer to connect with ${participant.name}`);
                        const peer = new Peer({
                            initiator: myId < participant.id,
                            trickle: false,
                            stream: stream,
                        });
                        
                        peer.on('signal', (signalData) => {
                            console.log(`[SIGNAL] Sending signal to ${participant.name}`);
                            addDoc(collection(db, "audioRooms", roomId, "signals"), {
                                to: participant.id,
                                from: myId,
                                signal: JSON.stringify(signalData),
                            });
                        });
                        
                        setupPeerListeners(peer, participant.id, participant.name);
                        peersRef.current[participant.id] = peer;
                    }
                });

                // Clean up left participants
                 currentPeerIds.forEach(peerId => {
                    if (!newParticipantIds.includes(peerId)) {
                        console.log(`[CLEANUP] Peer ${peerId} left. Destroying connection.`);
                        if (peersRef.current[peerId]) {
                            peersRef.current[peerId].destroy();
                            delete peersRef.current[peerId];
                        }
                        setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
                    }
                });
            });

            // 4. Set up signal listener
            const signalsQuery = query(collection(db, "audioRooms", roomId, "signals"), where("to", "==", myId));
            unsubSignals = onSnapshot(signalsQuery, (snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        const data = change.doc.data();
                        const fromId = data.from;
                        const signal = JSON.parse(data.signal);
                        const peer = peersRef.current[fromId];

                        if (peer && !peer.destroyed) {
                             console.log(`[SIGNAL] Received signal from ${fromId}. Applying.`);
                            peer.signal(signal);
                        }
                        await deleteDoc(change.doc.ref);
                    }
                });
            });
        };

        setupRoom();

        // MAIN CLEANUP FUNCTION
        return () => {
            console.log("[CLEANUP] Component unmounting. Cleaning up room resources.");
            unsubParticipants();
            unsubSignals();
            unsubRoom();
            handleLeaveRoom();
        };

    }, [currentUser, roomId, db, router, toast]);


    const handleMuteToggle = async () => {
        if (!localAudioStream || !currentUser || !db) return;

        const newMutedState = !isMuted;
        localAudioStream.getAudioTracks().forEach(track => track.enabled = !newMutedState);
        setIsMuted(newMutedState);

        const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        try {
            await updateDoc(participantRef, { isMuted: newMutedState });
        } catch (error) {
            console.error("Error updating mute state:", error);
            toast({ title: "Error", description: "Could not sync mute state.", variant: "destructive" });
        }
    };
    
    if (isLoading || !room) {
        return <SubpageLayout title="Sound Sphere Room"><div className="text-center">Loading room...</div></SubpageLayout>;
    }

    const isCreator = currentUser?.uid === room.creatorId;

    return (
        <SubpageLayout title={room.title}>
            {remoteStreams.map(remote => <AudioPlayer key={remote.peerId} stream={remote.stream} />)}
            <div className="mx-auto max-w-4xl text-center">
                <p className="text-muted-foreground mb-8">{room.description}</p>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Participants ({participants.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
                        {participants.map(p => (
                            <div key={p.id} className="relative flex flex-col items-center gap-2">
                                <Avatar className={`h-20 w-20 border-4 ${p.id === currentUser?.uid ? (isMuted ? 'border-transparent' : 'border-green-500') : (p.isMuted ? 'border-transparent' : 'border-green-500')}`}>
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
                    </CardContent>
                </Card>

                <div className="mt-8 flex justify-center gap-4">
                     <Button
                        variant={isMuted ? 'secondary' : 'outline'}
                        size="lg"
                        onClick={handleMuteToggle}
                        disabled={!localAudioStream}
                        className="w-28"
                    >
                        {isMuted ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                        {isMuted ? 'Unmute' : 'Mute'}
                    </Button>
                    <Button variant="outline" size="lg" onClick={() => handleLeaveRoom(false)}>
                        <LogOut className="mr-2 h-5 w-5" />
                        Leave
                    </Button>
                    {isCreator && (
                        <Button variant="destructive" size="lg" onClick={() => handleLeaveRoom(true)}>
                            <XCircle className="mr-2 h-5 w-5" />
                            End Room
                        </Button>
                    )}
                </div>
            </div>
        </SubpageLayout>
    );
}
