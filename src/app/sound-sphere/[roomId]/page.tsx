
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

// Moved outside the component to prevent re-creation on re-renders
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
    
    // 1. Get microphone permission and local audio stream
    useEffect(() => {
        const getMicPermission = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                setLocalAudioStream(stream);
            } catch (error) {
                console.error("Error accessing microphone:", error);
                toast({
                    variant: 'destructive',
                    title: 'Microphone Access Denied',
                    description: 'Please enable microphone permissions in your browser settings to participate.',
                });
            }
        };
        getMicPermission();

        return () => {
            localAudioStream?.getTracks().forEach(track => track.stop());
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2. Fetch initial room data, join room, and listen for participant changes
    useEffect(() => {
        if (!db || !roomId || !currentUser) return;

        const roomDocRef = doc(db, "audioRooms", roomId);
        
        const getRoomAndJoin = async () => {
             const roomSnap = await getDoc(roomDocRef);
             if (!roomSnap.exists()) {
                 toast({ title: "Room not found", description: "This room may have been deleted.", variant: "destructive" });
                 router.push('/sound-sphere');
                 return;
             }
             setRoom({ id: roomSnap.id, ...roomSnap.data() } as Room);
             
             // Join the room
             const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
             const participantSnap = await getDoc(participantRef);
             if (!participantSnap.exists()) {
                 await setDoc(participantRef, {
                     name: currentUser.displayName || 'Anonymous',
                     avatar: currentUser.photoURL || `https://placehold.co/96x96.png`,
                     isMuted: false,
                 });
                 await updateDoc(roomDocRef, { participantsCount: increment(1) });
             }
             setIsLoading(false);
        }
        getRoomAndJoin();

        const participantsColRef = collection(db, "audioRooms", roomId, "participants");
        const unsubscribeParticipants = onSnapshot(participantsColRef, (snapshot) => {
            const participantsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Participant));
            setParticipants(participantsList);
        });

        const unsubscribeRoom = onSnapshot(roomDocRef, (doc) => {
            if (!doc.exists()) {
                 if (!isLoading) {
                    toast({ title: "Room Ended", description: "The room has been closed.", variant: "default" });
                    router.push('/sound-sphere');
                 }
            }
        });


        return () => {
            unsubscribeParticipants();
            unsubscribeRoom();
        };

    }, [roomId, router, toast, currentUser, db, isLoading]);
    
    // 3. Initiate connections to other participants
    useEffect(() => {
        if (!localAudioStream || !participants.length || !currentUser) return;

        const myId = currentUser.uid;

        participants.forEach(participant => {
            const peerId = participant.id;
            if (peerId === myId || peersRef.current[peerId]) return;

            // To prevent double connections, the user with the "smaller" ID initiates
            if (myId < peerId) {
                console.log(`INITIATING connection to ${participant.name} (${peerId})`);
                const peer = new Peer({
                    initiator: true,
                    trickle: false,
                    stream: localAudioStream,
                });
                
                peer.on('signal', (offer) => {
                    console.log(`SENDING offer to ${peerId}`);
                    addDoc(collection(db, "audioRooms", roomId, "signals"), {
                        to: peerId,
                        from: myId,
                        signal: JSON.stringify(offer),
                    });
                });

                setupPeerListeners(peer, peerId, participant.name);
                peersRef.current[peerId] = peer;
            }
        });
    }, [participants, localAudioStream, currentUser, db, roomId]);

    // 4. Listen for signals from other participants
    useEffect(() => {
        if (!db || !roomId || !currentUser || !localAudioStream) return;

        const myId = currentUser.uid;
        const q = query(collection(db, "audioRooms", roomId, "signals"), where("to", "==", myId));
        
        const unsub = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const signalDoc = change.doc;
                    const data = signalDoc.data();
                    const fromId = data.from;
                    const fromName = participants.find(p => p.id === fromId)?.name || 'Someone';
                    const signal = JSON.parse(data.signal);

                    let peer = peersRef.current[fromId];

                    if (signal.type === 'offer') {
                        if (peer) {
                            console.warn(`Ignoring duplicate offer from ${fromName}`);
                        } else {
                            console.log(`RECEIVED offer from ${fromName} (${fromId}). Responding.`);
                            peer = new Peer({
                                initiator: false,
                                trickle: false,
                                stream: localAudioStream,
                            });
        
                            peer.on('signal', (answer) => {
                                console.log(`SENDING answer to ${fromId}`);
                                addDoc(collection(db, "audioRooms", roomId, "signals"), {
                                    to: fromId,
                                    from: myId,
                                    signal: JSON.stringify(answer),
                                });
                            });
        
                            setupPeerListeners(peer, fromId, fromName);
                            peersRef.current[fromId] = peer;
                            peer.signal(signal); // Process the offer
                        }
                    } else if (signal.type === 'answer') {
                        if (peer) {
                            console.log(`Processing answer from ${fromName} (${fromId})`);
                            peer.signal(signal); // Process the answer
                        } else {
                             console.warn(`Received an answer from ${fromName}, but no peer was ready.`);
                        }
                    }
                    // After processing, delete the signal doc
                    await deleteDoc(signalDoc.ref);
                }
            });
        });

        return () => unsub();
    }, [db, roomId, currentUser, localAudioStream, participants]);


    // 5. Clean up connections for users who have left
     useEffect(() => {
        const connectedPeerIds = Object.keys(peersRef.current);
        const participantIds = participants.map(p => p.id);
        
        connectedPeerIds.forEach(peerId => {
            if (!participantIds.includes(peerId)) {
                console.log(`CLEANING UP peer for left user ${peerId}`);
                peersRef.current[peerId].destroy();
                delete peersRef.current[peerId];
                setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
            }
        });
    }, [participants]);


    function setupPeerListeners(peer: PeerInstance, peerId: string, peerName: string) {
        peer.on('stream', (stream) => {
             console.log(`STREAM received from ${peerName} (${peerId})`);
             setRemoteStreams(prev => {
                if (prev.some(s => s.peerId === peerId)) return prev;
                return [...prev, { peerId: peerId, stream }];
             });
        });
        
        peer.on('error', (err) => {
            console.error(`Peer error with ${peerName} (${peerId}):`, err);
            toast({variant: 'destructive', title: `Connection to ${peerName} failed`, description: err.message})
        });

        peer.on('connect', () => {
            console.log(`CONNECTED to ${peerName} (${peerId})!`);
        });
        
        peer.on('close', () => {
             console.log(`CLOSED connection to ${peerName} (${peerId})`);
             setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
             if (peersRef.current[peerId]) {
                delete peersRef.current[peerId];
             }
        });
    }

    const handleLeaveRoom = async (isAutoCleanup = false) => {
        if (!db || !currentUser || !roomId) return;
        
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};
        
        const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        const roomRef = doc(db, "audioRooms", roomId);
        
        try {
            const currentRoomDoc = await getDoc(roomRef);
            const participantsSnap = await getDocs(collection(roomRef, "participants"));

            if (currentRoomDoc.exists() && participantsSnap.size <= 1) {
                // This will trigger other clients' listeners to leave
                await deleteDoc(roomRef); 
                if (!isAutoCleanup) toast({ title: "Room Ended", description: "The room was closed as it was empty." });
            } else {
                 await deleteDoc(participantRef);
                 await updateDoc(roomRef, { participantsCount: increment(-1) });
                 if (!isAutoCleanup) toast({ title: "You left the room." });
            }
             router.push('/sound-sphere');
        } catch (error) {
            console.error("Error leaving room: ", error);
            if (!isAutoCleanup) toast({ title: "Error", description: "Could not leave the room.", variant: "destructive" });
             router.push('/sound-sphere');
        }
    };
    
    const handleEndRoom = async () => {
        if (!db || !currentUser || !room || currentUser.uid !== room.creatorId) return;

        try {
            await deleteDoc(doc(db, "audioRooms", roomId));
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
    
    useEffect(() => {
        const handleBeforeUnload = () => {
            handleLeaveRoom(true);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            handleLeaveRoom(true);
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
