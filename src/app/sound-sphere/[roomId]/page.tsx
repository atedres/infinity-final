"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, updateDoc, increment } from 'firebase/firestore';
import { LogOut, XCircle } from 'lucide-react';

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
    isTalking?: boolean;
}

export default function AudioRoomPage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const roomId = params.roomId as string;

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
        if (!db || !roomId) return;

        const roomDocRef = doc(db, "audioRooms", roomId);

        const unsubscribeRoom = onSnapshot(roomDocRef, (doc) => {
            if (doc.exists()) {
                setRoom({ id: doc.id, ...doc.data() } as Room);
            } else {
                toast({ title: "Room not found", description: "This room may have been deleted.", variant: "destructive" });
                router.push('/sound-sphere');
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

    }, [roomId, router, toast]);

    useEffect(() => {
        if (!db || !currentUser || !roomId) return;

        const joinRoom = async () => {
            const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
            const roomRef = doc(db, "audioRooms", roomId);

            const participantSnap = await getDoc(participantRef);
            if (!participantSnap.exists()) {
                await setDoc(participantRef, {
                    name: currentUser.displayName || 'Anonymous',
                    avatar: currentUser.photoURL || `https://placehold.co/96x96.png`,
                    isTalking: false,
                });
                await updateDoc(roomRef, { participantsCount: increment(1) });
            }
        };

        joinRoom();

    }, [currentUser, roomId]);

    const handleLeaveRoom = async () => {
        if (!db || !currentUser || !roomId) return;

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
    
    const handleEndRoom = async () => {
        if (!db || !currentUser || !room || currentUser.uid !== room.creatorId) return;

        try {
            // In a real app, you would also need to delete the subcollection.
            // For this prototype, just deleting the room doc is sufficient.
            await deleteDoc(doc(db, "audioRooms", roomId));
            toast({ title: "Room Ended", description: "The room has been closed for everyone." });
            router.push('/sound-sphere');
        } catch (error) {
            console.error("Error ending room: ", error);
            toast({ title: "Error", description: "Could not end the room.", variant: "destructive" });
        }
    };

    if (isLoading || !room) {
        return <SubpageLayout title="Sound Sphere Room"><div className="text-center">Loading room...</div></SubpageLayout>;
    }

    const isCreator = currentUser?.uid === room.creatorId;

    return (
        <SubpageLayout title={room.title}>
            <div className="mx-auto max-w-4xl text-center">
                <p className="text-muted-foreground mb-8">{room.description}</p>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Participants ({participants.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
                        {participants.map(p => (
                            <div key={p.id} className="flex flex-col items-center gap-2">
                                <Avatar className={`h-20 w-20 border-2 ${p.id === room.creatorId ? 'border-amber-400' : 'border-transparent'} ${p.isTalking ? 'ring-4 ring-green-500 ring-offset-2 ring-offset-background' : ''}`}>
                                    <AvatarImage src={p.avatar} data-ai-hint="person portrait"/>
                                    <AvatarFallback>{p.name?.[0]}</AvatarFallback>
                                </Avatar>
                                <p className="font-medium text-sm truncate w-full">{p.name}</p>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                <div className="mt-8 flex justify-center gap-4">
                    <Button variant="outline" onClick={handleLeaveRoom}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Leave Quietly
                    </Button>
                    {isCreator && (
                        <Button variant="destructive" onClick={handleEndRoom}>
                            <XCircle className="mr-2 h-4 w-4" />
                            End Room for All
                        </Button>
                    )}
                </div>
            </div>
        </SubpageLayout>
    );
}