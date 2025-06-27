
"use client";

import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, doc, addDoc, serverTimestamp, setDoc, getDoc, updateDoc, increment, writeBatch, deleteDoc, Timestamp, getDocs, deleteField } from 'firebase/firestore';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';
import 'webrtc-adapter';

import { db, auth, storage } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, ArrowLeft, Phone, PhoneOff, Mic, MicOff, LogOut, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSound } from '@/hooks/use-notification-sound';


// Interfaces for our data structures
interface Chat {
    id: string;
    participantNames: { [key: string]: string };
    participants: string[];
    lastMessage: string;
    lastUpdate: any;
    unreadCounts?: { [key: string]: number };
}

interface EnrichedChat extends Chat {
    otherParticipant: {
        id: string;
        name: string;
        avatar: string;
    };
    unreadCount: number;
}

interface ChatMessage {
    id: string;
    text: string;
    senderId: string;
    timestamp: any;
}

interface IncomingCall {
    fromId: string;
    fromName: string;
    fromAvatar: string;
    chatId: string;
    signal: string;
}

export interface Room {
    id: string;
    title: string;
    description: string;
    creatorId: string;
    pinnedLink?: string;
    roles?: { [key: string]: 'speaker' | 'moderator' };
    createdAt: Timestamp;
}

export interface Participant {
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


const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
    const ref = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.srcObject = stream;
    }, [stream]);
    return <audio ref={ref} autoPlay playsInline />;
};

const FloatingRoomContext = createContext<any>(null);
export const useFloatingRoom = () => useContext(FloatingRoomContext);


// Helper to set up all event handlers for a peer
const setupPeerHandlers = (peer: PeerInstance, peerId: string, context: any) => {
    const { setRemoteStreams, peersRef, toast } = context;

    peer.on('signalerror', (err: Error) => {
        console.error(`Peer signal error with ${peerId}:`, err);
        toast({ title: "Connection Error", description: `Could not connect to a user in the room.`, variant: "destructive" });
    });

    peer.on('stream', (stream: MediaStream) => {
        setRemoteStreams((prev: RemoteStream[]) => {
            // Avoid adding duplicate streams
            if (prev.some(s => s.peerId === peerId)) return prev;
            return [...prev, { peerId, stream }];
        });
    });

    peer.on('error', (err: Error) => {
        console.error(`Peer connection error with ${peerId}:`, err);
        if (peersRef.current[peerId]) {
            peersRef.current[peerId].destroy();
        }
    });

    peer.on('close', () => {
        if (peersRef.current[peerId]) {
            delete peersRef.current[peerId];
        }
        setRemoteStreams((prev: RemoteStream[]) => prev.filter(s => s.peerId !== peerId));
    });
};


export function FloatingRoomProvider({ children }: { children: React.ReactNode }) {
    const { toast } = useToast();
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
    const [isFloating, setIsFloating] = useState(false);

    // Room State
    const [roomData, setRoomData] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [speakingRequests, setSpeakingRequests] = useState<SpeakRequest[]>([]);
    const [isMuted, setIsMuted] = useState(true);
    const [hasRequested, setHasRequested] = useState(false);
    const [speakerInvitation, setSpeakerInvitation] = useState<SpeakerInvitation | null>(null);
    const [elapsedTime, setElapsedTime] = useState('00:00');
    const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
    const [isRoomLoading, setIsRoomLoading] = useState(true);

    // User relations state
    const [followingIds, setFollowingIds] = useState<string[]>([]);
    const [blockedIds, setBlockedIds] = useState<string[]>([]);
    const [profileStats, setProfileStats] = useState<ProfileStats | null>(null);
    const [isStatsLoading, setIsStatsLoading] = useState(false);

    // WebRTC State
    const localStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<Record<string, PeerInstance>>({});
    const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
    const cleanupRef = useRef<() => void>();

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, user => setCurrentUser(user));
        return unsub;
    }, []);

    const getMicStream = useCallback(async () => {
        try {
            if (localStreamRef.current) {
                return localStreamRef.current;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = stream;
            return stream;
        } catch (err) {
            toast({ title: "Microphone Error", description: "Could not access your microphone.", variant: "destructive" });
            return null;
        }
    }, [toast]);
    
    const changeRole = useCallback(async (targetId: string, newRole: 'moderator' | 'speaker' | 'listener') => {
        if (!db || !activeRoomId || !currentUser) return;
        const participantRef = doc(db, "audioRooms", activeRoomId, "participants", targetId);
        
        // If a mod is inviting a listener, send an invitation
        const participantSnap = await getDoc(participantRef);
        if (newRole === 'speaker' && participantSnap.data()?.role === 'listener' && targetId !== currentUser.uid) {
            await setDoc(doc(db, "audioRooms", activeRoomId, "invitations", targetId), { inviterId: currentUser.uid, inviterName: currentUser.displayName });
            toast({ title: "Invitation Sent" });
            return;
        }
        
        // Otherwise, change role directly
        const batch = writeBatch(db);
        batch.update(participantRef, { role: newRole, isMuted: newRole === 'listener' });
        if (newRole === 'listener') {
            batch.update(doc(db, "audioRooms", activeRoomId), { [`roles.${targetId}`]: deleteField() });
        } else {
            batch.update(doc(db, "audioRooms", activeRoomId), { [`roles.${targetId}`]: newRole });
        }
        await batch.commit();
        toast({ title: "Role Updated" });
    }, [activeRoomId, currentUser, toast]);
    
    const leaveRoom = useCallback(async () => {
        if (!activeRoomId || !currentUser || !db) return;
    
        const roomIdForCleanup = activeRoomId;
    
        cleanupRef.current?.();
        cleanupRef.current = undefined;
    
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};
    
        try {
            const participantRef = doc(db, "audioRooms", roomIdForCleanup, "participants", currentUser.uid);
            await deleteDoc(participantRef);
    
            // After deleting, check if the room is now empty.
            const participantsCollectionRef = collection(db, "audioRooms", roomIdForCleanup, "participants");
            const remainingParticipantsSnap = await getDocs(participantsCollectionRef);
    
            if (remainingParticipantsSnap.empty) {
                // Last one out, delete the room.
                const roomDocRef = doc(db, "audioRooms", roomIdForCleanup);
                const roomSnap = await getDoc(roomDocRef);
                if (roomSnap.exists()) {
                    await deleteDoc(roomDocRef);
                }
            }
        } catch (error) {
            console.warn("Could not execute leave-room cleanup operations.", error);
        }
    
        setActiveRoomId(null);
        setRoomData(null);
        setParticipants([]);
        setRemoteStreams([]);
        setIsFloating(false);
    }, [activeRoomId, currentUser, db]);


    const joinRoom = useCallback(async (roomId: string) => {
        if (!currentUser || !db) return;
        if (activeRoomId && activeRoomId !== roomId) {
            await leaveRoom();
        }
        setIsRoomLoading(true);
        setActiveRoomId(roomId);
        setIsFloating(false);

        await getMicStream();

        const banRef = doc(db, "audioRooms", roomId, "bannedUsers", currentUser.uid);
        const banSnap = await getDoc(banRef);
        if (banSnap.exists()) {
            toast({ title: "Access Denied", description: "You have been banned from this room.", variant: "destructive" });
            leaveRoom();
            return;
        }
        
        const roomDocRef = doc(db, "audioRooms", roomId);
        const roomSnap = await getDoc(roomDocRef);
        if (!roomSnap.exists()) {
             leaveRoom();
             setIsRoomLoading(false);
             return;
        }
        const initialRoomData = roomSnap.data() as Room;
        const myRole = initialRoomData.creatorId === currentUser.uid ? 'creator' : (initialRoomData.roles?.[currentUser.uid] || 'listener');
        const initialMute = myRole === 'listener';

        const participantRef = doc(db, "audioRooms", roomId, "participants", currentUser.uid);
        await setDoc(participantRef, {
            name: currentUser.displayName,
            avatar: currentUser.photoURL,
            isMuted: initialMute,
            role: myRole,
        }, { merge: true });
        setIsMuted(initialMute);

        if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !initialMute);
        }

        const unsubscribes: (() => void)[] = [];

        // 1. Listen for room document changes
        unsubscribes.push(onSnapshot(roomDocRef, (docSnap) => {
            if (!docSnap.exists()) {
                setRoomData(null);
                leaveRoom();
                return;
            }
            setRoomData({ id: docSnap.id, ...docSnap.data() } as Room);
        }));

        const contextForPeerHandlers = { setRemoteStreams, peersRef, toast };
        
        // 2. Listen for participant changes to manage peers
        const participantsColRef = collection(db, "audioRooms", roomId, "participants");
        unsubscribes.push(onSnapshot(participantsColRef, (snapshot) => {
            const newParticipants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Participant));
            const currentPeerIds = Object.keys(peersRef.current);

            setParticipants(newParticipants);

            const participantIds = new Set(newParticipants.map(p => p.id));

            // Connect to new participants
            newParticipants.forEach(p => {
                if (p.id !== currentUser.uid && !peersRef.current[p.id] && localStreamRef.current) {
                    // The user with the greater ID initiates the connection
                    const isInitiator = currentUser.uid > p.id;
                    if (isInitiator) {
                        const peer = new Peer({ initiator: true, trickle: false, stream: localStreamRef.current, config: { iceServers } });
                        
                        peer.on('signal', offerSignal => {
                            addDoc(collection(db, `audioRooms/${roomId}/signals`), { to: p.id, from: currentUser.uid, signal: JSON.stringify(offerSignal) });
                        });
                        
                        setupPeerHandlers(peer, p.id, contextForPeerHandlers);
                        peersRef.current[p.id] = peer;
                    }
                }
            });

            // Clean up disconnected peers
            currentPeerIds.forEach(peerId => {
                if (!participantIds.has(peerId)) {
                    peersRef.current[peerId]?.destroy();
                }
            });
        }));

        // 3. Listen for incoming WebRTC signals
        const signalsQuery = query(collection(db, `audioRooms/${roomId}/signals`), where("to", "==", currentUser.uid));
        unsubscribes.push(onSnapshot(signalsQuery, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    const signal = JSON.parse(data.signal);
                    const fromId = data.from;
                    
                    if (signal.type === 'offer') {
                        if (peersRef.current[fromId] || !localStreamRef.current) return;
                        
                        const peer = new Peer({ initiator: false, trickle: false, stream: localStreamRef.current, config: { iceServers } });
                        
                        peer.on('signal', answerSignal => {
                           addDoc(collection(db, `audioRooms/${roomId}/signals`), { to: fromId, from: currentUser.uid, signal: JSON.stringify(answerSignal) });
                        });

                        setupPeerHandlers(peer, fromId, contextForPeerHandlers);
                        peersRef.current[fromId] = peer;
                        peer.signal(signal);

                    } else if (signal.type === 'answer') {
                        const peer = peersRef.current[fromId];
                        if (peer && !peer.destroyed) {
                            peer.signal(signal);
                        }
                    }
                    await deleteDoc(change.doc.ref);
                }
            });
        }));

        // 4. Other listeners (requests, chat, invites)
        unsubscribes.push(onSnapshot(collection(db, "audioRooms", roomId, "requests"), s => setSpeakingRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as SpeakRequest)))));
        unsubscribes.push(onSnapshot(query(collection(db, "audioRooms", roomId, "chatMessages"), orderBy("createdAt", "asc")), s => setChatMessages(s.docs.map(d => ({ id: d.id, ...d.data() } as RoomChatMessage)))));
        unsubscribes.push(onSnapshot(doc(db, "audioRooms", roomId, "invitations", currentUser.uid), d => setSpeakerInvitation(d.exists() ? d.data() as SpeakerInvitation : null)));

        const myRequestRef = doc(db, "audioRooms", roomId, "requests", currentUser.uid);
        getDoc(myRequestRef).then(snap => setHasRequested(snap.exists()));
        
        setIsRoomLoading(false);
        cleanupRef.current = () => unsubscribes.forEach(unsub => unsub());

    }, [currentUser, activeRoomId, toast, getMicStream, leaveRoom]);
    
    // Auto-moderator promotion logic
    useEffect(() => {
        if (!activeRoomId || !db || participants.length === 0 || !roomData) return;

        const autoPromote = async () => {
            const admins = participants.filter(p => p.role === 'creator' || p.role === 'moderator');
            const speakers = participants.filter(p => p.role === 'speaker');

            if (admins.length === 0 && speakers.length > 0) {
                const newModerator = speakers[0];
                if (newModerator && newModerator.id) {
                    if (roomData.roles?.[newModerator.id] !== 'moderator') {
                        await changeRole(newModerator.id, 'moderator');
                        toast({
                            title: "New Moderator",
                            description: `${newModerator.name} has been promoted to moderator.`
                        });
                    }
                }
            }
        };
        autoPromote();
      }, [participants, activeRoomId, db, roomData, changeRole, toast]);

    
    const endRoom = useCallback(async () => {
        if (!activeRoomId || !currentUser || !db || !roomData) return;
        
        const myParticipantData = participants.find(p => p.id === currentUser.uid);
        const isModerator = myParticipantData?.role === 'creator' || myParticipantData?.role === 'moderator';

        if (!isModerator) {
            toast({ title: "Permission Denied", description: "Only a moderator can end the room.", variant: "destructive" });
            return;
        }
        
        // Delete the room document, which will trigger cleanup for all participants
        await deleteDoc(doc(db, "audioRooms", activeRoomId));
        await leaveRoom();

    }, [activeRoomId, currentUser, roomData, participants, leaveRoom, db, toast]);
    
    const showFloatingPlayer = useCallback(() => {
        if (activeRoomId) setIsFloating(true);
    }, [activeRoomId]);

    const toggleMute = useCallback(async () => {
        if (!localStreamRef.current || !currentUser || !db || !activeRoomId) return;
        const newMutedState = !isMuted;
        localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !newMutedState);
        setIsMuted(newMutedState);
        await updateDoc(doc(db, "audioRooms", activeRoomId, "participants", currentUser.uid), { isMuted: newMutedState });
    }, [isMuted, activeRoomId, currentUser]);

     const requestToSpeak = useCallback(async () => {
        if (!currentUser || !db || !activeRoomId) return;
        await setDoc(doc(db, "audioRooms", activeRoomId, "requests", currentUser.uid), { name: currentUser.displayName, avatar: currentUser.photoURL });
        setHasRequested(true);
        toast({ title: "Request Sent" });
    }, [currentUser, activeRoomId, toast]);

    const manageRequest = useCallback(async (requesterId: string, accept: boolean) => {
        if (!db || !currentUser || !activeRoomId) return;
        await deleteDoc(doc(db, "audioRooms", activeRoomId, "requests", requesterId));
        if (accept) {
            await setDoc(doc(db, "audioRooms", activeRoomId, "invitations", requesterId), { inviterId: currentUser.uid, inviterName: currentUser.displayName });
        }
    }, [currentUser, activeRoomId]);
    
    const acceptInvite = useCallback(async () => {
        if (!db || !currentUser || !activeRoomId) return;
        const batch = writeBatch(db);
        batch.update(doc(db, "audioRooms", activeRoomId, "participants", currentUser.uid), { role: 'speaker', isMuted: false });
        batch.update(doc(db, "audioRooms", activeRoomId), { [`roles.${currentUser.uid}`]: 'speaker' });
        batch.delete(doc(db, "audioRooms", activeRoomId, "invitations", currentUser.uid));
        await batch.commit();
        setIsMuted(false);
        localStreamRef.current?.getAudioTracks().forEach(track => track.enabled = true);
        toast({ title: "You are now a speaker!" });
    }, [currentUser, activeRoomId, toast]);
    
    const declineInvite = useCallback(async () => {
        if (!db || !currentUser || !activeRoomId) return;
        await deleteDoc(doc(db, "audioRooms", activeRoomId, "invitations", currentUser.uid));
    }, [currentUser, activeRoomId]);
    
    const removeUser = useCallback(async (targetId: string) => {
        if (!db || !activeRoomId || !currentUser) return;
        const batch = writeBatch(db);
        batch.set(doc(db, "audioRooms", activeRoomId, "bannedUsers", targetId), { bannedAt: serverTimestamp(), bannedBy: currentUser.uid });
        batch.delete(doc(db, "audioRooms", activeRoomId, "participants", targetId));
        await batch.commit();
        toast({ title: "User Banned" });
    }, [activeRoomId, currentUser, toast]);

    const selfPromoteToSpeaker = useCallback(async () => {
        if (!db || !currentUser || !activeRoomId) return;
        const participantRef = doc(db, "audioRooms", activeRoomId, "participants", currentUser.uid);
        await updateDoc(participantRef, { role: 'speaker', isMuted: false });
        setIsMuted(false);
        localStreamRef.current?.getAudioTracks().forEach(track => track.enabled = true);
        toast({ title: "You are now a speaker!" });
    }, [currentUser, activeRoomId, toast, db]);

    const sendChatMessage = useCallback(async (text: string) => {
        if (!db || !currentUser || !activeRoomId || !text.trim()) return;
        await addDoc(collection(db, "audioRooms", activeRoomId, "chatMessages"), {
            text,
            senderId: currentUser.uid,
            senderName: currentUser.displayName,
            senderAvatar: currentUser.photoURL,
            createdAt: serverTimestamp(),
        });
    }, [currentUser, activeRoomId]);

    const pinLink = useCallback(async (link: string) => {
        if (!db || !activeRoomId) return;
        await updateDoc(doc(db, "audioRooms", activeRoomId), { pinnedLink: link });
        toast({ title: "Link Pinned" });
    }, [activeRoomId, toast]);

    const unpinLink = useCallback(async () => {
        if (!db || !activeRoomId) return;
        await updateDoc(doc(db, "audioRooms", activeRoomId), { pinnedLink: deleteField() });
        toast({ title: "Link Unpinned" });
    }, [activeRoomId, toast]);

    const updateRoomTitle = useCallback(async (title: string) => {
        if (!db || !activeRoomId) return;
        await updateDoc(doc(db, "audioRooms", activeRoomId), { title });
        toast({ title: "Title Updated" });
    }, [activeRoomId, toast]);


    useEffect(() => {
        if (!roomData?.createdAt) return;
        const interval = setInterval(() => {
            const diff = new Date().getTime() - roomData.createdAt.toDate().getTime();
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            const p = (n: number) => n.toString().padStart(2, '0');
            setElapsedTime(h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`);
        }, 1000);
        return () => clearInterval(interval);
    }, [roomData?.createdAt]);


    const value = {
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
        changeRole,
        acceptInvite,
        declineInvite,
        removeUser,
        sendChatMessage,
        pinLink,
        unpinLink,
        updateRoomTitle,
        showFloatingPlayer,
        storage,
        isRoomLoading,
        remoteStreams,
        activeRoomId,
        isFloating,
        selfPromoteToSpeaker,
    };

    return (
        <FloatingRoomContext.Provider value={value}>
            {children}
        </FloatingRoomContext.Provider>
    );
}

function RoomAudioRenderer() {
    const { remoteStreams, activeRoomId } = useFloatingRoom();
    if (!activeRoomId || !remoteStreams) return null;

    return (
        <div style={{ display: 'none' }}>
            {remoteStreams.map((remote: RemoteStream) => (
                <AudioPlayer key={remote.peerId} stream={remote.stream} />
            ))}
        </div>
    );
}

function FloatingRoomPlayer() {
    const { activeRoomId, isFloating, roomData, leaveRoom, isMuted, toggleMute, participants, currentUser } = useFloatingRoom();

    if (!isFloating || !roomData || !currentUser) {
        return null;
    }

    const myParticipantData = participants.find(p => p.id === currentUser.uid);
    const canSpeak = myParticipantData?.role === 'creator' || myParticipantData?.role === 'moderator' || myParticipantData?.role === 'speaker';

    return (
        <div className="fixed bottom-6 right-24 z-50">
            <Card className="w-80 shadow-2xl">
                <CardContent className="p-3 flex items-center justify-between gap-2">
                     <Link href={`/sound-sphere/${activeRoomId}`} className="flex-1 truncate pr-2 cursor-pointer group">
                        <p className="font-semibold truncate group-hover:underline">{roomData.title}</p>
                        <p className="text-sm text-muted-foreground">Click to re-join</p>
                    </Link>
                    <div className="flex items-center gap-1">
                        {canSpeak && (
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={toggleMute}
                                className="h-9 w-9"
                            >
                                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                                 <span className="sr-only">{isMuted ? 'Unmute' : 'Mute'}</span>
                            </Button>
                        )}
                        <Button variant="destructive" size="icon" onClick={leaveRoom} className="h-9 w-9">
                            <LogOut className="h-4 w-4" />
                            <span className="sr-only">Leave Room</span>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}


function ChatLauncherUI() {
    const { toast } = useToast();
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [conversations, setConversations] = useState<EnrichedChat[]>([]);
    const [totalUnread, setTotalUnread] = useState(0);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [selectedChat, setSelectedChat] = useState<EnrichedChat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const playMessageSound = useNotificationSound('/notification.mp3');
    const isInitialChatsLoad = useRef(true);

    const conversationsRef = useRef(conversations);
    conversationsRef.current = conversations;
    const selectedChatRef = useRef(selectedChat);
    selectedChatRef.current = selectedChat;
    
    // Call State
    const [callState, setCallState] = useState<'idle' | 'calling' | 'receiving' | 'active'>('idle');
    const callStateRef = useRef(callState);
    callStateRef.current = callState;
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const peerRef = useRef<PeerInstance | null>(null);
    const incomingCallAudioRef = useRef<HTMLAudioElement | null>(null);
    const outgoingCallAudioRef = useRef<HTMLAudioElement | null>(null);


    // Listen for auth changes
    useEffect(() => {
        if (!auth || !db) return;
        const unsubscribe = onAuthStateChanged(auth, user => {
            setCurrentUser(user);
            if (!user) {
                // Clear all state on logout
                setConversations([]);
                setMessages([]);
                setSelectedChat(null);
                setIsOpen(false);
                setTotalUnread(0);
                isInitialChatsLoad.current = true;
                endCall(false);
            }
        });

        return () => {
            unsubscribe();
        };
    }, []);

    // Call sound effect
    useEffect(() => {
        if (typeof window === 'undefined') return;

        if (!incomingCallAudioRef.current) {
            incomingCallAudioRef.current = new Audio('/incoming-call.mp3');
            incomingCallAudioRef.current.loop = true;
        }
        if (!outgoingCallAudioRef.current) {
            outgoingCallAudioRef.current = new Audio('/outgoing-call.mp3');
            outgoingCallAudioRef.current.loop = true;
        }

        const playIncoming = () => incomingCallAudioRef.current?.play().catch(e => console.error("Error playing incoming call sound: ", e));
        const playOutgoing = () => outgoingCallAudioRef.current?.play().catch(e => console.error("Error playing outgoing call sound: ", e));
        
        const stopAll = () => {
            if (incomingCallAudioRef.current && !incomingCallAudioRef.current.paused) {
                incomingCallAudioRef.current.pause();
                incomingCallAudioRef.current.currentTime = 0;
            }
            if (outgoingCallAudioRef.current && !outgoingCallAudioRef.current.paused) {
                outgoingCallAudioRef.current.pause();
                outgoingCallAudioRef.current.currentTime = 0;
            }
        };

        if (callState === 'receiving') {
            stopAll();
            playIncoming();
        } else if (callState === 'calling') {
            stopAll();
            playOutgoing();
        } else { // 'idle' or 'active'
            stopAll();
        }
        
        return stopAll; 

    }, [callState]);
    
    // Global listener for P2P signals
    useEffect(() => {
        if (!currentUser || !db) return;
        
        const signalsQuery = query(collection(db, "p2p_signals"), where("to", "==", currentUser.uid));
        
        const unsubscribe = onSnapshot(signalsQuery, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    const signal = JSON.parse(data.signal);
                    
                    if (signal.type === 'offer' && callStateRef.current === 'idle') {
                        setIncomingCall({
                           fromId: data.from,
                           fromName: data.fromName,
                           fromAvatar: data.fromAvatar,
                           chatId: data.chatId,
                           signal: data.signal,
                        });
                        setCallState('receiving');
                    } else if (signal.type === 'answer' && callStateRef.current === 'calling') {
                        peerRef.current?.signal(signal);
                    } else if (signal.type === 'end-call') {
                         if (callStateRef.current !== 'idle') {
                            toast({ title: 'Call Ended' });
                            endCall(false);
                         }
                    } else if (peerRef.current && !peerRef.current.destroyed) {
                        peerRef.current?.signal(signal);
                    }
                    
                    await deleteDoc(change.doc.ref);
                }
            });
        });
        
        return () => unsubscribe();
    }, [currentUser, toast]);


    // Fetch and enrich conversations when user is logged in
    useEffect(() => {
        if (!currentUser || !db) return;

        const chatsQuery = query(
            collection(db, "chats"),
            where("participants", "array-contains", currentUser.uid),
            orderBy("lastUpdate", "desc")
        );

        const unsubscribe = onSnapshot(chatsQuery, async (snapshot) => {
            const isInitialLoad = isInitialChatsLoad.current;
            if (isInitialChatsLoad.current) {
                isInitialChatsLoad.current = false;
            }

            const hadNewMessageForMe = snapshot.docChanges().some(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    const data = change.doc.data();
                    const oldChat = conversationsRef.current.find(c => c.id === change.doc.id);
                    const oldUnread = oldChat?.unreadCount || 0;
                    const newUnread = data.unreadCounts?.[currentUser.uid] || 0;
                    const isNewUnread = newUnread > oldUnread;
                    const isNotSelectedChat = selectedChatRef.current?.id !== change.doc.id;
                    return isNewUnread && isNotSelectedChat;
                }
                return false;
            });
            
            if (!isInitialLoad && hadNewMessageForMe) {
                 playMessageSound();
            }


            const chatsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chat));
            let unreadSum = 0;
            
            const enrichedChats = await Promise.all(chatsData.map(async (chat) => {
                const otherId = chat.participants.find(p => p !== currentUser.uid) || '';
                const otherName = chat.participantNames?.[otherId] || 'User';
                const unreadCount = chat.unreadCounts?.[currentUser.uid] || 0;
                unreadSum += unreadCount;

                let otherAvatar = '';
                if (otherId) {
                    try {
                        const userDoc = await getDoc(doc(db, "users", otherId));
                        if (userDoc.exists()) {
                            otherAvatar = userDoc.data().photoURL || '';
                        }
                    } catch (error) {
                         console.error("Could not fetch user avatar for chat list", error);
                    }
                }

                return {
                    ...chat,
                    otherParticipant: { id: otherId, name: otherName, avatar: otherAvatar },
                    unreadCount: unreadCount,
                };
            }));
            
            setConversations(enrichedChats);
            setTotalUnread(unreadSum);

        }, (error) => {
            console.error("Firestore chat listener error: ", error);
            if (error.code === 'failed-precondition') {
                toast({
                    title: "Database Index Required",
                    description: "A one-time database setup is needed. Check the browser's developer console for a direct link to create the required index.",
                    variant: "destructive",
                    duration: 15000,
                });
            }
        });

        return () => unsubscribe();
    }, [currentUser, toast, playMessageSound]);

    // Fetch messages when a chat is selected
    useEffect(() => {
        if (!selectedChat || !db) {
            setMessages([]);
            return;
        }

        const messagesQuery = query(collection(db, "chats", selectedChat.id, "messages"), orderBy("timestamp", "asc"));
        const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
            setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage)));
        });

        return () => unsubscribe();
    }, [selectedChat]);
    
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        const handleOpenChat = async (event: Event) => {
            if (!currentUser || !db) return;

            const customEvent = event as CustomEvent<{ userId: string }>;
            const { userId } = customEvent.detail;

            const existingChat = conversations.find(c => c.otherParticipant.id === userId);

            if (existingChat) {
                handleSelectChat(existingChat);
            } else {
                const otherUserDocRef = doc(db, "users", userId);
                const otherUserDocSnap = await getDoc(otherUserDocRef);

                if (otherUserDocSnap.exists()) {
                    const otherUserData = otherUserDocSnap.data();
                    const virtualChat: EnrichedChat = {
                        id: [currentUser.uid, userId].sort().join('_'),
                        participants: [currentUser.uid, userId],
                        participantNames: {
                            [currentUser.uid]: currentUser.displayName || 'Me',
                            [userId]: `${otherUserData.firstName} ${otherUserData.lastName}`
                        },
                        lastMessage: 'Start the conversation',
                        lastUpdate: serverTimestamp(),
                        otherParticipant: {
                            id: userId,
                            name: `${otherUserData.firstName} ${otherUserData.lastName}`,
                            avatar: otherUserData.photoURL || ''
                        },
                        unreadCount: 0,
                    };
                    handleSelectChat(virtualChat);
                } else {
                    toast({ title: 'Error', description: 'Could not find user to chat with.', variant: 'destructive'});
                }
            }
            setIsOpen(true);
        };

        window.addEventListener('open-chat', handleOpenChat);

        return () => {
            window.removeEventListener('open-chat', handleOpenChat);
        };
    }, [currentUser, db, conversations, toast]);
    
    const sendSignal = async (to: string, chatId: string, signal: any) => {
        if (!db || !currentUser) return;
        await addDoc(collection(db, "p2p_signals"), {
            from: currentUser.uid,
            fromName: currentUser.displayName || 'Anonymous',
            fromAvatar: currentUser.photoURL || '',
            to,
            chatId,
            signal: JSON.stringify(signal),
        });
    };

    const getMicStream = async (): Promise<MediaStream | null> => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            return stream;
        } catch (error) {
            console.error("Error getting user media:", error);
            toast({ title: "Microphone Error", description: "Could not access your microphone. Please grant permission when prompted.", variant: "destructive" });
            return null;
        }
    }

    const endCall = async (notifyPeer = true) => {
        if (notifyPeer && peerRef.current?.destroyed === false && selectedChat && currentUser) {
            await sendSignal(selectedChat.otherParticipant.id, selectedChat.id, { type: 'end-call' });
        }
        
        peerRef.current?.destroy();
        peerRef.current = null;
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        
        setRemoteStream(null);
        setCallState('idle');
        setIsMuted(false);
        setIncomingCall(null);
    };

    const startCall = async (chat: EnrichedChat) => {
        if (!currentUser || !db) return;
        
        const stream = await getMicStream();
        if (!stream) {
            setCallState('idle');
            return;
        }
        localStreamRef.current = stream;
        setCallState('calling');
        
        const peer = new Peer({ initiator: true, trickle: false, stream: stream, config: { iceServers } });
        peerRef.current = peer;

        peer.on('signal', (signal) => sendSignal(chat.otherParticipant.id, chat.id, signal));
        peer.on('stream', (remoteStream) => {
            setRemoteStream(remoteStream);
            setCallState('active');
        });
        peer.on('close', () => endCall(false));
        peer.on('error', (err) => {
            console.error('Peer error:', err);
            toast({ title: "Call Error", description: "An error occurred during the call.", variant: "destructive" });
            endCall(false);
        });
    };
    
    const answerCall = async () => {
        if (!currentUser || !db || !incomingCall) return;
        
        const stream = await getMicStream();
        if (!stream) {
            endCall(false);
            declineCall();
            return;
        }
        localStreamRef.current = stream;
        
        const peer = new Peer({ initiator: false, trickle: false, stream: stream, config: { iceServers } });
        peerRef.current = peer;
        
        const chatWithCaller = conversations.find(c => c.id === incomingCall.chatId);
        setSelectedChat(chatWithCaller || null);
        setCallState('active');
        
        peer.on('signal', (signal) => sendSignal(incomingCall.fromId, incomingCall.chatId, signal));
        peer.on('stream', (remoteStream) => setRemoteStream(remoteStream));
        peer.on('close', () => endCall(false));
        peer.on('error', (err) => {
             console.error('Peer error:', err);
             endCall(false);
        });
        
        peer.signal(JSON.parse(incomingCall.signal));
        setIncomingCall(null);
    };

    const declineCall = async () => {
        if (incomingCall) {
            await sendSignal(incomingCall.fromId, incomingCall.chatId, { type: 'end-call' });
        }
        setIncomingCall(null);
        setCallState('idle');
    };

    const toggleMute = () => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser || !selectedChat || !newMessage.trim()) return;

        const otherId = selectedChat.participants.find(p => p !== currentUser.uid);
        if (!otherId) return;

        const chatDocRef = doc(db, "chats", selectedChat.id);
        
        try {
            const batch = writeBatch(db);
            const newMessageRef = doc(collection(db, "chats", selectedChat.id, "messages"));
            batch.set(newMessageRef, {
                text: newMessage,
                senderId: currentUser.uid,
                timestamp: serverTimestamp(),
            });

            batch.set(chatDocRef, {
                    lastMessage: newMessage,
                    lastUpdate: serverTimestamp(),
                    participants: selectedChat.participants,
                    participantNames: selectedChat.participantNames,
                    unreadCounts: {
                        [otherId]: increment(1),
                        [currentUser.uid]: 0,
                    }
                }, { merge: true }
            );
            await batch.commit();
            setNewMessage('');
        } catch (error) {
            console.error("Error sending message:", error);
            toast({ title: "Error", description: "Could not send message.", variant: "destructive" });
        }
    };
    
    const handleSelectChat = async (chat: EnrichedChat) => {
        if (!currentUser || !db) return;
        setSelectedChat(chat);
        if (chat.unreadCount > 0) {
            try {
                await setDoc(doc(db, "chats", chat.id), {
                    unreadCounts: { [currentUser.uid]: 0 }
                }, { merge: true });
            } catch (error) {
                console.warn("Could not mark chat as read", error);
            }
        }
    };
    
    useEffect(() => {
        if (!isOpen) setSelectedChat(null);
    }, [isOpen]);

    if (!currentUser) return null;

    const CallDialog = () => {
        const otherParticipant = selectedChat?.otherParticipant;
        const caller = incomingCall;
        let name, avatar;
        if (callState === 'active' || callState === 'calling') {
            name = otherParticipant?.name;
            avatar = otherParticipant?.avatar;
        } else if (callState === 'receiving') {
            name = caller?.fromName;
            avatar = caller?.fromAvatar;
        }
        
        return (
            <Dialog open={callState === 'active' || callState === 'calling'}>
                <DialogContent className="sm:max-w-xs" onInteractOutside={(e) => e.preventDefault()}>
                    <div className="flex flex-col items-center justify-center gap-4 py-8">
                        <Avatar className="h-24 w-24 border-2 border-primary">
                            <AvatarImage src={avatar} alt={name}/>
                            <AvatarFallback className="text-3xl">{name?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="text-center">
                            <p className="text-xl font-semibold">{name}</p>
                            <p className="text-sm text-muted-foreground">
                                {callState === 'calling' && 'Calling...'}
                                {callState === 'active' && 'Connected'}
                            </p>
                        </div>
                        <div className="flex items-center gap-4 mt-8">
                             {callState === 'active' && (
                                <Button variant="outline" size="icon" className="h-14 w-14 rounded-full" onClick={toggleMute}>
                                    {isMuted ? <MicOff className="h-6 w-6"/> : <Mic className="h-6 w-6"/>}
                                </Button>
                            )}
                            <Button variant="destructive" size="icon" className="h-14 w-14 rounded-full" onClick={() => endCall()}>
                                <PhoneOff className="h-6 w-6"/>
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        );
    };

    return (
        <>
            {remoteStream && <AudioPlayer stream={remoteStream} />}
            <CallDialog />
             <AlertDialog open={callState === 'receiving'}>
                <AlertDialogContent>
                    <AlertDialogHeader className="items-center">
                         <Avatar className="h-20 w-20">
                            <AvatarImage src={incomingCall?.fromAvatar} alt={incomingCall?.fromName}/>
                            <AvatarFallback className="text-2xl">{incomingCall?.fromName?.[0]}</AvatarFallback>
                        </Avatar>
                        <AlertDialogTitle>{incomingCall?.fromName} is calling</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="justify-center">
                        <AlertDialogCancel asChild>
                            <Button variant="destructive" size="lg" className="rounded-full" onClick={declineCall}>Decline</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button variant="default" size="lg" className="rounded-full bg-green-600 hover:bg-green-700" onClick={answerCall}>Accept</Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50 bg-background hover:bg-accent">
                        <MessageSquare className="h-7 w-7 text-primary" />
                        {totalUnread > 0 && (
                            <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground">
                                {totalUnread > 9 ? '9+' : totalUnread}
                            </span>
                        )}
                    </Button>
                </SheetTrigger>
                <SheetContent className="flex flex-col p-0" side="right">
                    <SheetHeader className="p-4 pb-2 border-b">
                        {selectedChat ? (
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedChat(null)}>
                                    <ArrowLeft className="h-5 w-5" />
                                </Button>
                                <Avatar className="h-9 w-9">
                                    <AvatarImage src={selectedChat.otherParticipant.avatar} />
                                    <AvatarFallback>{selectedChat.otherParticipant.name?.[0]}</AvatarFallback>
                                </Avatar>
                                <SheetTitle>{selectedChat.otherParticipant.name}</SheetTitle>
                                <Button variant="ghost" size="icon" className="ml-auto" onClick={() => startCall(selectedChat)}>
                                    <Phone className="h-5 w-5"/>
                                </Button>
                            </div>
                        ) : (
                            <SheetTitle>Conversations</SheetTitle>
                        )}
                    </SheetHeader>

                    {selectedChat ? (
                        <>
                            <ScrollArea className="flex-1 px-4">
                                <div className="space-y-4 py-4">
                                    {messages.map(message => (
                                        <div key={message.id} className={cn("flex w-max max-w-[75%] flex-col gap-1 rounded-lg px-3 py-2 text-sm",
                                            message.senderId === currentUser?.uid ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                                        )}>
                                            {message.text}
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>
                            </ScrollArea>
                            <SheetFooter className="p-4 border-t">
                                <form onSubmit={handleSendMessage} className="w-full flex gap-2">
                                    <Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." autoComplete="off"/>
                                    <Button type="submit" size="icon" disabled={!newMessage.trim()}>
                                        <Send className="h-4 w-4" />
                                    </Button>
                                </form>
                            </SheetFooter>
                        </>
                    ) : (
                        <ScrollArea className="flex-1">
                            <div className="py-2">
                                {conversations.length > 0 ? conversations.map(chat => (
                                    <button 
                                        key={chat.id} 
                                        onClick={() => handleSelectChat(chat)}
                                        className={cn(
                                            "w-full flex items-center gap-3 p-3 text-left hover:bg-muted border-b",
                                            chat.unreadCount > 0 && "bg-primary/10 hover:bg-primary/20"
                                        )}
                                    >
                                        <Avatar>
                                            <AvatarImage src={chat.otherParticipant.avatar} />
                                            <AvatarFallback>{chat.otherParticipant.name?.[0]}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 truncate">
                                            <p className="font-semibold">{chat.otherParticipant.name}</p>
                                            <p className="text-sm text-muted-foreground truncate">{chat.lastMessage}</p>
                                        </div>
                                        {chat.unreadCount > 0 && (
                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                                                {chat.unreadCount}
                                            </span>
                                        )}
                                    </button>
                                )) : (
                                    <div className="text-center text-muted-foreground p-8">
                                        <p>No conversations yet.</p>
                                        <p className="text-sm">Start a chat from a user's profile.</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}


export function ChatLauncher() {
    return (
        <>
            <RoomAudioRenderer />
            <ChatLauncherUI />
            <FloatingRoomPlayer />
        </>
    )
}
