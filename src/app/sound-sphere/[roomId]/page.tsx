
"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, updateDoc, increment } from 'firebase/firestore';
import { Mic, MicOff, LogOut, XCircle } from 'lucide-react';

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

export default function AudioRoomPage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const roomId = params.roomId as string;
    const audioRef = useRef<HTMLAudioElement>(null);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [hasMicPermission, setHasMicPermission] = useState(false);

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
    
    useEffect(() => {
        const getMicPermission = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                setAudioStream(stream);
                setHasMicPermission(true);
                if (audioRef.current) {
                    audioRef.current.srcObject = stream;
                }
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
            audioStream?.getTracks().forEach(track => track.stop());
        };
    }, []);

    useEffect(() => {
        if (!db || !roomId) return;

        const roomDocRef = doc(db, "audioRooms", roomId);

        const unsubscribeRoom = onSnapshot(roomDocRef, (doc) => {
            if (doc.exists()) {
                setRoom({ id: doc.id, ...doc.data() } as Room);
            } else {
                // This will trigger if the room is deleted
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

    }, [currentUser, roomId, hasMicPermission]);

    const handleLeaveRoom = async () => {
        if (!db || !currentUser || !roomId) return;
        
        // If I am the last participant, end the room for everyone.
        if (participants.length <= 1) {
            handleEndRoom(true); // pass true to indicate it's an automatic cleanup
            return;
        }

        const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        const roomRef = doc(db, "audioRooms", roomId);
        
        try {
            await deleteDoc(participantRef);
            await updateDoc(roomRef, { participantsCount: increment(-1) });
            toast({ title: "You left the room." });
            router.push('/sound-sphere');
        } catch (error) {
            console.error("Error leaving room: ", error);
            toast({ title: "Error", description: "Could not leave the room.", variant: "destructive" });
        }
    };
    
    const handleEndRoom = async (isAutoCleanup = false) => {
        if (!db || !currentUser || !room) return;
        if (!isAutoCleanup && currentUser.uid !== room.creatorId) return;

        try {
            await deleteDoc(doc(db, "audioRooms", roomId));
            toast({ 
                title: isAutoCleanup ? "Room Ended" : "Room Closed", 
                description: isAutoCleanup ? "The room was closed as it was empty." : "The room has been closed for everyone." 
            });
            router.push('/sound-sphere');
        } catch (error) {
            console.error("Error ending room: ", error);
            toast({ title: "Error", description: "Could not end the room.", variant: "destructive" });
        }
    };

    const handleMuteToggle = async () => {
        if (!audioStream || !currentUser || !db) return;

        const newMutedState = !isMuted;
        audioStream.getAudioTracks().forEach(track => track.enabled = !newMutedState);
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
            <audio ref={audioRef} autoPlay muted playsInline className="hidden" />
            <div className="mx-auto max-w-4xl text-center">
                <p className="text-muted-foreground mb-8">{room.description}</p>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Participants ({participants.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
                        {participants.map(p => (
                            <div key={p.id} className="relative flex flex-col items-center gap-2">
                                <Avatar className={`h-20 w-20 border-2 ${p.id === room.creatorId ? 'border-amber-400' : 'border-transparent'}`}>
                                    <AvatarImage src={p.avatar} data-ai-hint="person portrait"/>
                                    <AvatarFallback>{p.name?.[0]}</AvatarFallback>
                                </Avatar>
                                {p.isMuted && (
                                    <div className="absolute top-0 right-0 bg-slate-700 rounded-full p-1 border-2 border-background">
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
                    <Button variant="outline" size="lg" onClick={handleLeaveRoom}>
                        <LogOut className="mr-2 h-5 w-5" />
                        Leave
                    </Button>
                    {isCreator && (
                        <Button variant="destructive" size="lg" onClick={() => handleEndRoom(false)}>
                            <XCircle className="mr-2 h-5 w-5" />
                            End Room
                        </Button>
                    )}
                </div>
            </div>
        </SubpageLayout>
    );
}
