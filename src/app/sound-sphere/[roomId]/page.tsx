
"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
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

    return <audio ref={ref} autoPlay />;
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
    const [hasMicPermission, setHasMicPermission] = useState(false);
    
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
    
    // 1. Get microphone permission and local audio stream
    useEffect(() => {
        const getMicPermission = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                setLocalAudioStream(stream);
                setHasMicPermission(true);
            } catch (error) {
                console.error("Error accessing microphone:", error);
                setHasMicPermission(false);
                toast({
                    variant: 'destructive',
                    title: 'Microphone Access Denied',
                    description: 'Please enable microphone permissions in your browser settings to participate.',
                });
            }
        };
        getMicPermission();

        return () => {
            // Stop local stream on component unmount
            localAudioStream?.getTracks().forEach(track => track.stop());
            Object.values(peersRef.current).forEach(peer => peer.destroy());
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2. Fetch initial room data and listen for participant changes
    useEffect(() => {
        if (!db || !roomId) return;

        const roomDocRef = doc(db, "audioRooms", roomId);
        const unsubscribeRoom = onSnapshot(roomDocRef, (doc) => {
            if (doc.exists()) {
                setRoom({ id: doc.id, ...doc.data() } as Room);
            } else {
                if (!isLoading) {
                    toast({ title: "Room not found", description: "This room may have been deleted.", variant: "destructive" });
                    router.push('/sound-sphere');
                }
            }
            setIsLoading(false);
        });

        const participantsColRef = collection(db, "audioRooms", roomId, "participants");
        const unsubscribeParticipants = onSnapshot(participantsColRef, (snapshot) => {
            const participantsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Participant));
            setParticipants(participantsList);
        });

        return () => {
            unsubscribeRoom();
            unsubscribeParticipants();
        };

    }, [roomId, router, toast, isLoading]);

    // 3. Join room in Firestore once user and permissions are ready
    useEffect(() => {
        if (!db || !currentUser || !roomId || !hasMicPermission) return;

        const joinRoom = async () => {
            const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
            const roomRef = doc(db, "audioRooms", roomId);

            const participantSnap = await getDoc(participantRef);
            if (!participantSnap.exists()) {
                await setDoc(participantRef, {
                    name: currentUser.displayName || 'Anonymous',
                    avatar: currentUser.photoURL || `https://placehold.co/96x96.png`,
                    isMuted: false,
                });
                await updateDoc(roomRef, { participantsCount: increment(1) });
            }
        };

        joinRoom();
    }, [currentUser, roomId, hasMicPermission, db]);
    
    // 4. Manage Peer Connections based on participant list
    useEffect(() => {
        if (!currentUser || !localAudioStream || participants.length === 0) return;

        // Create peers for new participants
        participants.forEach(participant => {
            if (participant.id === currentUser.uid || peersRef.current[participant.id]) return;

            console.log(`Creating peer for ${participant.name} (I am initiator)`);
            const peer = new Peer({
                initiator: true, 
                trickle: false,
                stream: localAudioStream,
            });

            peer.on('signal', signal => {
                console.log(`Sending signal to ${participant.id}`);
                addDoc(collection(db, "audioRooms", roomId, "signals"), {
                    to: participant.id,
                    from: currentUser.uid,
                    signal: JSON.stringify(signal),
                });
            });

            setupPeerListeners(peer, participant.id);
            peersRef.current[participant.id] = peer;
        });

        // Clean up peers for participants who have left
        const participantIds = participants.map(p => p.id);
        Object.keys(peersRef.current).forEach(peerId => {
            if(!participantIds.includes(peerId)){
                console.log(`Destroying peer for left participant ${peerId}`);
                peersRef.current[peerId].destroy();
                delete peersRef.current[peerId];
                setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
            }
        })

    }, [participants, currentUser, localAudioStream, db, roomId]);

    // 5. Listen for incoming signals
    useEffect(() => {
        if (!db || !roomId || !currentUser || !localAudioStream) return;

        const q = query(collection(db, "audioRooms", roomId, "signals"), where("to", "==", currentUser.uid));
        
        const unsub = onSnapshot(q, (snapshot) => {
            snapshot.forEach(async (signalDoc) => {
                const data = signalDoc.data();
                const fromId = data.from;
                const signal = JSON.parse(data.signal);
                
                // If a peer connection already exists, just signal it
                if(peersRef.current[fromId]){
                    console.log(`Signaling existing peer from ${fromId}`);
                    peersRef.current[fromId].signal(signal);
                } else {
                    // If no peer exists, it means the other user initiated. Create a non-initiator peer.
                    console.log(`Creating peer for ${fromId} (they are initiator)`);
                    const peer = new Peer({
                        initiator: false,
                        trickle: false,
                        stream: localAudioStream,
                    });

                    // This signal is the offer from the other peer, we accept it.
                    peer.signal(signal);

                    // When we signal back with our answer, send it through Firestore.
                    peer.on('signal', (answerSignal) => {
                         console.log(`Sending answer signal to ${fromId}`);
                         addDoc(collection(db, "audioRooms", roomId, "signals"), {
                             to: fromId,
                             from: currentUser.uid,
                             signal: JSON.stringify(answerSignal),
                         });
                    });

                    setupPeerListeners(peer, fromId);
                    peersRef.current[fromId] = peer;
                }
                
                // Delete the signal document after processing
                await deleteDoc(signalDoc.ref);
            });
        });

        return () => unsub();

    }, [db, roomId, currentUser, localAudioStream]);

    function setupPeerListeners(peer: PeerInstance, peerId: string) {
        peer.on('stream', (stream) => {
             console.log(`Received stream from ${peerId}`);
             setRemoteStreams(prev => {
                if (prev.some(s => s.peerId === peerId)) return prev;
                return [...prev, { peerId: peerId, stream }];
             });
        });
        
        peer.on('error', (err) => {
            console.error(`Peer error with ${peerId}:`, err);
            // Optionally, try to reconnect or show an error to the user
        });

        peer.on('connect', () => {
            console.log(`Successfully connected to ${peerId}!`);
        });
        
        peer.on('close', () => {
             console.log(`Peer connection closed for ${peerId}`);
             setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
             if (peersRef.current[peerId]) {
                delete peersRef.current[peerId];
             }
        });
    }

    const handleLeaveRoom = async (isAutoCleanup = false) => {
        if (!db || !currentUser || !roomId) return;
        
        const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        const roomRef = doc(db, "audioRooms", roomId);
        
        try {
            // Using a transaction could be safer here, but for a prototype this is fine
            const currentRoomDoc = await getDoc(roomRef);
            if (currentRoomDoc.exists() && currentRoomDoc.data().participantsCount <= 1) {
                await deleteDoc(roomRef); // This will trigger listeners to clean up signals/participants
                toast({ title: "Room Ended", description: "The room was closed as it was empty." });
            } else {
                 await deleteDoc(participantRef);
                 await updateDoc(roomRef, { participantsCount: increment(-1) });
                 if (!isAutoCleanup) toast({ title: "You left the room." });
            }
             Object.values(peersRef.current).forEach(peer => peer.destroy());
             router.push('/sound-sphere');
        } catch (error) {
            console.error("Error leaving room: ", error);
            if (!isAutoCleanup) toast({ title: "Error", description: "Could not leave the room.", variant: "destructive" });
        }
    };
    
    const handleEndRoom = async () => {
        if (!db || !currentUser || !room || currentUser.uid !== room.creatorId) return;

        try {
            await deleteDoc(doc(db, "audioRooms", roomId));
            toast({ title: "Room Closed", description: "The room has been closed for everyone." });
            // Router push will be handled by the room listener detecting deletion
        } catch (error) {
            console.error("Error ending room: ", error);
            toast({ title: "Error", description: "Could not end the room.", variant: "destructive" });
        }
    };

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
    
    // Auto leave on browser close/refresh
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            handleLeaveRoom(true);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser, roomId]);


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
                                <Avatar className={`h-20 w-20 border-4 ${!p.isMuted ? 'border-green-500' : 'border-transparent'}`}>
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
                        disabled={!hasMicPermission}
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
