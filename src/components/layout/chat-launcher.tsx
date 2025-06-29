
"use client";

import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, doc, addDoc, serverTimestamp, setDoc, getDoc, updateDoc, increment, writeBatch, deleteDoc, getDocs, Timestamp, deleteField } from 'firebase/firestore';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';
import 'webrtc-adapter';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { db, auth, storage } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, ArrowLeft, Phone, PhoneOff, Mic, MicOff, ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { ToastAction } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// Interfaces for our data structures
// Chat interfaces
interface Chat { id: string; participantNames: { [key: string]: string }; participants: string[]; lastMessage: string; lastUpdate: any; unreadCounts?: { [key: string]: number }; }
interface EnrichedChat extends Chat { otherParticipant: { id: string; name: string; avatar: string; }; unreadCount: number; }
interface ChatMessage { id: string; text: string; senderId: string; timestamp: any; }
interface IncomingCall { fromId: string; fromName: string; fromAvatar: string; chatId: string; signal: string; }

// Room interfaces
export interface Room { id: string; title: string; description: string; creatorId: string; pinnedLink?: string; roles?: { [key: string]: 'speaker' | 'moderator' }; createdAt: Timestamp; }
export interface Participant { id: string; name: string; avatar: string; isMuted: boolean; role: 'creator' | 'moderator' | 'speaker' | 'listener'; }
export interface SpeakRequest { id: string; name: string; avatar: string; }
export interface RoomChatMessage { id: string; text: string; senderId: string; senderName: string; senderAvatar: string; createdAt: Timestamp; }
interface RemoteStream { peerId: string; stream: MediaStream; }
export interface SpeakerInvitation { inviterId: string; inviterName: string; }

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
    const ref = useRef<HTMLAudioElement>(null);
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return <audio ref={ref} autoPlay playsInline />;
};

// --- Audio Room Context ---
interface AudioRoomContextType {
  roomData: Room | null;
  participants: Participant[];
  speakingRequests: SpeakRequest[];
  chatMessages: RoomChatMessage[];
  speakerInvitation: SpeakerInvitation | null;
  isMuted: boolean;
  myRole?: 'creator' | 'moderator' | 'speaker' | 'listener';
  canSpeak: boolean;
  hasRequested: boolean;
  elapsedTime: string;
  joinRoom: (roomId: string) => void;
  leaveRoom: (options?: { navigate?: boolean }) => Promise<void>;
  promptToLeave: () => void;
  endRoomForAll: () => void;
  toggleMute: () => void;
  requestToSpeak: () => void;
  manageRequest: (requesterId: string, accept: boolean) => void;
  changeRole: (targetId: string, newRole: 'moderator' | 'speaker' | 'listener') => void;
  acceptInvite: () => void;
  declineInvite: () => void;
  removeUser: (targetId: string) => void;
  selfPromoteToSpeaker: () => void;
  pinLink: (url: string) => void;
  unpinLink: () => void;
  updateRoomTitle: (title: string) => void;
  sendChatMessage: (text: string) => void;
  handlePictureUpload: (file: File) => Promise<void>;
}
const AudioRoomContext = createContext<AudioRoomContextType | null>(null);
export const useAudioRoom = () => {
    const context = useContext(AudioRoomContext);
    if (!context) throw new Error('useAudioRoom must be used within an AudioRoomProvider');
    return context;
}

export function ChatLauncher({ children }: { children: React.ReactNode }) {
    const { toast } = useToast();
    const router = useRouter();
    const pathname = usePathname();
    
    // --- P2P Chat/Call State ---
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isChatSheetOpen, setIsChatSheetOpen] = useState(false);
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
    const [p2pCallState, setP2PCallState] = useState<'idle' | 'calling' | 'receiving' | 'active'>('idle');
    const callStateRef = useRef(p2pCallState);
    callStateRef.current = p2pCallState;
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const [isP2pMuted, setIsP2PMuted] = useState(false);
    const p2pPeerRef = useRef<PeerInstance | null>(null);
    const incomingCallAudioRef = useRef<HTMLAudioElement | null>(null);
    const outgoingCallAudioRef = useRef<HTMLAudioElement | null>(null);
    const p2pLocalStreamRef = useRef<MediaStream | null>(null);
    const [p2pRemoteStream, setP2PRemoteStream] = useState<MediaStream | null>(null);
    
    // --- Audio Room State ---
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const [roomData, setRoomData] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [speakingRequests, setSpeakingRequests] = useState<SpeakRequest[]>([]);
    const [roomIsMuted, setRoomIsMuted] = useState(true);
    const [hasRequested, setHasRequested] = useState(false);
    const [speakerInvitation, setSpeakerInvitation] = useState<SpeakerInvitation | null>(null);
    const [elapsedTime, setElapsedTime] = useState('00:00');
    const [roomChatMessages, setRoomChatMessages] = useState<RoomChatMessage[]>([]);
    const roomLocalStreamRef = useRef<MediaStream | null>(null);
    const roomPeersRef = useRef<Record<string, PeerInstance>>({});
    const [roomRemoteStreams, setRoomRemoteStreams] = useState<RemoteStream[]>([]);
    const [showFloatingPlayer, setShowFloatingPlayer] = useState(false);
    const roomUnsubscribes = useRef<(() => void)[]>([]);

    // --- Combined Auth & Cleanup ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, user => {
            setCurrentUser(user);
            if (!user) {
                // Clear all state on logout
                setConversations([]); setMessages([]); setSelectedChat(null); setIsChatSheetOpen(false); setTotalUnread(0); isInitialChatsLoad.current = true;
                endP2PCall(false);
                if (currentRoomId) leaveRoom({ navigate: false });
            }
        });
        return () => unsubscribe();
    }, [currentRoomId]); // Add currentRoomId to re-run if it changes

    // Hide floating player when on the room page
    useEffect(() => {
        if (currentRoomId && pathname.startsWith(`/sound-sphere/${currentRoomId}`)) {
          setShowFloatingPlayer(false);
        }
    }, [pathname, currentRoomId]);


    // --- Audio Room Logic ---
    const leaveRoom = useCallback(async (options: { navigate?: boolean } = {}) => {
        if (!currentRoomId || !currentUser || !db) return;
        
        Object.values(roomPeersRef.current).forEach(peer => peer.destroy());
        roomPeersRef.current = {};
        roomLocalStreamRef.current?.getTracks().forEach(track => track.stop());
        roomLocalStreamRef.current = null;
        setRoomRemoteStreams([]);
        
        const participantRef = doc(db, "audioRooms", currentRoomId, "participants", currentUser.uid);
        await deleteDoc(participantRef);

        const remainingParticipantsSnap = await getDocs(collection(db, "audioRooms", currentRoomId, "participants"));
        if (remainingParticipantsSnap.empty) {
            await deleteDoc(doc(db, "audioRooms", currentRoomId));
        }

        roomUnsubscribes.current.forEach(unsub => unsub());
        roomUnsubscribes.current = [];
        
        setCurrentRoomId(null);
        setRoomData(null);
        setParticipants([]);
        setSpeakingRequests([]);
        setRoomChatMessages([]);
        setRoomIsMuted(true);
        setHasRequested(false);
        setShowFloatingPlayer(false);

        if (options.navigate) {
            router.push('/sound-sphere?tab=rooms');
        }
    }, [currentRoomId, currentUser, db, router]);
    
    const sendSignal = async (to: string, chatId: string, signal: any, type: 'p2p-call' | 'room-offer' | 'room-answer') => {
        if (!db || !currentUser) return;
        await addDoc(collection(db, "signals"), {
            from: currentUser.uid, fromName: currentUser.displayName, fromAvatar: currentUser.photoURL, to, chatId, signal: JSON.stringify(signal), type
        });
    };

    const joinRoom = useCallback(async (roomId: string) => {
        if (currentRoomId === roomId || !currentUser || !db) return;
        if (currentRoomId) await leaveRoom({ navigate: false }); // Leave previous room if any

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            roomLocalStreamRef.current = stream;

            const roomDocRef = doc(db, "audioRooms", roomId);
            const roomSnap = await getDoc(roomDocRef);
            if (!roomSnap.exists()) {
                toast({ title: "Room not found or has ended." });
                router.push('/sound-sphere?tab=rooms');
                return;
            }
            setCurrentRoomId(roomId);

            const initialRoomData = roomSnap.data() as Room;
            const myRole = initialRoomData.creatorId === currentUser.uid ? 'creator' : (initialRoomData.roles?.[currentUser.uid] || 'listener');
            const initialMute = myRole === 'listener';
            setRoomIsMuted(initialMute);
            if(roomLocalStreamRef.current) roomLocalStreamRef.current.getAudioTracks().forEach(t => t.enabled = !initialMute);

            await setDoc(doc(db, "audioRooms", roomId, "participants", currentUser.uid), {
                name: currentUser.displayName, avatar: currentUser.photoURL, isMuted: initialMute, role: myRole,
            }, { merge: true });

            const unsubs: (() => void)[] = [];
            unsubs.push(onSnapshot(roomDocRef, (docSnap) => {
                if(docSnap.exists()) {
                    setRoomData({ id: docSnap.id, ...docSnap.data() } as Room)
                } else {
                    toast({ title: "Room Ended", description: "The host has ended the room." });
                    leaveRoom({ navigate: true });
                }
            }));
            unsubs.push(onSnapshot(collection(db, "audioRooms", roomId, "participants"), (snapshot) => {
                const newParticipants = snapshot.docs.map(p => ({ id: p.id, ...p.data() } as Participant));
                setParticipants(newParticipants);
                
                // --- New Robust Connection Logic ---
                newParticipants.forEach(p => {
                    if (p.id !== currentUser.uid && !roomPeersRef.current[p.id] && roomLocalStreamRef.current) {
                        // The user with the greater ID initiates the connection.
                        if (currentUser.uid > p.id) {
                            const peer = new Peer({ initiator: true, stream: roomLocalStreamRef.current, trickle: false, config: { iceServers } });
                            peer.on('signal', offer => sendSignal(p.id, roomId, offer, 'room-offer'));
                            peer.on('stream', stream => setRoomRemoteStreams(prev => [...prev.filter(s => s.peerId !== p.id), { peerId: p.id, stream }]));
                            peer.on('close', () => setRoomRemoteStreams(prev => prev.filter(s => s.peerId !== p.id)));
                            peer.on('error', (err) => { console.error(`Peer error with ${p.id}:`, err); roomPeersRef.current[p.id]?.destroy(); delete roomPeersRef.current[p.id]; });
                            roomPeersRef.current[p.id] = peer;
                        }
                    }
                });
                
                // Clean up peers for users who have left
                Object.keys(roomPeersRef.current).forEach(peerId => {
                    if (!newParticipants.some(p => p.id === peerId)) {
                        roomPeersRef.current[peerId]?.destroy();
                        delete roomPeersRef.current[peerId];
                        setRoomRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
                    }
                });
            }));
            unsubs.push(onSnapshot(collection(db, "audioRooms", roomId, "requests"), s => setSpeakingRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as SpeakRequest)))));
            unsubs.push(onSnapshot(query(collection(db, "audioRooms", roomId, "chatMessages"), orderBy("createdAt", "asc")), s => setRoomChatMessages(s.docs.map(d => ({ id: d.id, ...d.data() } as RoomChatMessage)))));
            unsubs.push(onSnapshot(doc(db, "audioRooms", roomId, "invitations", currentUser.uid), d => setSpeakerInvitation(d.exists() ? d.data() as SpeakerInvitation : null)));
            getDoc(doc(db, "audioRooms", roomId, "requests", currentUser.uid)).then(snap => setHasRequested(snap.exists()));
            roomUnsubscribes.current = unsubs;
        } catch (err) {
            console.error("Failed to join room:", err);
            toast({ title: "Error", description: "Could not join room. Check microphone permissions.", variant: "destructive" });
        }
    }, [currentUser, db, toast, router, currentRoomId, leaveRoom]);
    
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
    
    const myParticipantData = participants.find(p => p.id === currentUser?.uid);
    const myRole = myParticipantData?.role;
    const canSpeak = myRole === 'creator' || myRole === 'moderator' || myRole === 'speaker';

    const endRoomForAll = useCallback(async () => {
        if (!currentRoomId || !currentUser || !db) return;
        const roomDocRef = doc(db, "audioRooms", currentRoomId);
        const roomDocSnap = await getDoc(roomDocRef);
        if(roomDocSnap.exists() && roomDocSnap.data().creatorId !== currentUser.uid) {
            toast({ title: "Permission Denied", description: "Only the room creator can end the room.", variant: "destructive" });
            return;
        }
    
        try {
            // Delete the room document. onSnapshot listeners on clients will handle their own cleanup.
            await deleteDoc(roomDocRef);
            toast({ title: "Room Ended", description: "The room has been closed for all participants." });
        } catch (error) {
            console.error("Error ending room for all:", error);
            toast({ title: "Error", description: "Could not end the room.", variant: "destructive" });
        }
    }, [currentRoomId, currentUser, db, toast]);

    const toggleMute = async () => {
        if (!roomLocalStreamRef.current || !currentUser || !currentRoomId) return;
        const newMutedState = !roomIsMuted;
        roomLocalStreamRef.current.getAudioTracks().forEach(track => track.enabled = !newMutedState);
        setRoomIsMuted(newMutedState);
        await updateDoc(doc(db, "audioRooms", currentRoomId, "participants", currentUser.uid), { isMuted: newMutedState });
    };
    const requestToSpeak = async () => {
        if (!currentUser || !currentRoomId) return;
        await setDoc(doc(db, "audioRooms", currentRoomId, "requests", currentUser.uid), { name: currentUser.displayName, avatar: currentUser.photoURL });
        setHasRequested(true); toast({ title: "Request Sent" });
    };
    const manageRequest = async (requesterId: string, accept: boolean) => {
        if (!currentRoomId || !currentUser) return;
        await deleteDoc(doc(db, "audioRooms", currentRoomId, "requests", requesterId));
        if (accept) { await setDoc(doc(db, "audioRooms", currentRoomId, "invitations", requesterId), { inviterId: currentUser.uid, inviterName: currentUser.displayName }); }
    };
    const changeRole = async (targetId: string, newRole: 'moderator' | 'speaker' | 'listener') => {
        if (!currentRoomId) return;
        await updateDoc(doc(db, "audioRooms", currentRoomId, "participants", targetId), { role: newRole, isMuted: newRole === 'listener' });
        toast({ title: "Role Updated" });
    };
    const acceptInvite = async () => {
        if (!currentUser || !currentRoomId) return;
        await updateDoc(doc(db, "audioRooms", currentRoomId, "participants", currentUser.uid), { role: 'speaker', isMuted: false });
        await deleteDoc(doc(db, "audioRooms", currentRoomId, "invitations", currentUser.uid));
        setRoomIsMuted(false);
        if (roomLocalStreamRef.current) roomLocalStreamRef.current.getAudioTracks().forEach(t => t.enabled = true);
        toast({ title: "You are now a speaker!" });
    };
    const declineInvite = async () => { if (currentUser && currentRoomId) await deleteDoc(doc(db, "audioRooms", currentRoomId, "invitations", currentUser.uid)); };
    const removeUser = async (targetId: string) => {
        if (!currentUser || !currentRoomId) return;
        const batch = writeBatch(db);
        batch.set(doc(db, "audioRooms", currentRoomId, "bannedUsers", targetId), { bannedAt: serverTimestamp(), bannedBy: currentUser.uid });
        batch.delete(doc(db, "audioRooms", currentRoomId, "participants", targetId));
        await batch.commit(); toast({ title: "User Banned" });
    };
    const selfPromoteToSpeaker = async () => {
        if (!currentUser || !currentRoomId) return;
        await updateDoc(doc(db, "audioRooms", currentRoomId, "participants", currentUser.uid), { role: 'speaker', isMuted: false });
        setRoomIsMuted(false); if (roomLocalStreamRef.current) roomLocalStreamRef.current.getAudioTracks().forEach(t => t.enabled = true);
    };
    const pinLink = async (url: string) => { if (currentRoomId) await updateDoc(doc(db, "audioRooms", currentRoomId), { pinnedLink: url }); toast({ title: "Link Pinned" }); };
    const unpinLink = async () => { if (currentRoomId) await updateDoc(doc(db, "audioRooms", currentRoomId), { pinnedLink: deleteField() }); };
    const updateRoomTitle = async (title: string) => { if (currentRoomId) await updateDoc(doc(db, "audioRooms", currentRoomId), { title }); };
    const sendChatMessage = async (text: string) => {
        if (!currentUser || !currentRoomId || !text.trim()) return;
        await addDoc(collection(db, "audioRooms", currentRoomId, "chatMessages"), { text, senderId: currentUser.uid, senderName: currentUser.displayName, senderAvatar: currentUser.photoURL, createdAt: serverTimestamp() });
    };
    const handlePictureUpload = async (file: File) => {
        if (!storage || !currentUser || !db || !currentRoomId) return;
        const filePath = `profile-pictures/${currentUser.uid}/${Date.now()}-${file.name}`;
        const fileRef = storageRef(storage, filePath);
        try {
            toast({ title: 'Uploading...' });
            const uploadResult = await uploadBytes(fileRef, file);
            const photoURL = await getDownloadURL(uploadResult.ref);
            const batch = writeBatch(db);
            batch.update(doc(db, "users", currentUser.uid), { photoURL });
            batch.update(doc(db, "audioRooms", currentRoomId, "participants", currentUser.uid), { avatar: photoURL });
            await batch.commit();
            toast({ title: 'Success!', description: 'Profile picture updated.' });
        } catch (error: any) { toast({ title: 'Upload Failed', variant: 'destructive' }); }
    };
    const promptToLeave = () => {
        const { dismiss } = toast({
          title: "Leaving Audio Room",
          description: "Do you want to keep listening while you browse?",
          duration: 15000,
          action: (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 w-full">
              <ToastAction altText="Keep Listening" onClick={() => {
                setShowFloatingPlayer(true);
                router.push('/');
                dismiss();
              }}>
                Keep Listening
              </ToastAction>
              <ToastAction altText="Leave Room" onClick={async () => {
                await leaveRoom({ navigate: true });
                dismiss();
              }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Leave Room
              </ToastAction>
            </div>
          ),
        });
      };
      
    // --- P2P Chat/Call Logic ---
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!incomingCallAudioRef.current) { incomingCallAudioRef.current = new Audio('/incoming-call.mp3'); incomingCallAudioRef.current.loop = true; }
        if (!outgoingCallAudioRef.current) { outgoingCallAudioRef.current = new Audio('/outgoing-call.mp3'); outgoingCallAudioRef.current.loop = true; }
        const playIncoming = () => incomingCallAudioRef.current?.play().catch(e => console.error("Error playing incoming call sound: ", e));
        const playOutgoing = () => outgoingCallAudioRef.current?.play().catch(e => console.error("Error playing outgoing call sound: ", e));
        const stopAll = () => {
            if (incomingCallAudioRef.current && !incomingCallAudioRef.current.paused) { incomingCallAudioRef.current.pause(); incomingCallAudioRef.current.currentTime = 0; }
            if (outgoingCallAudioRef.current && !outgoingCallAudioRef.current.paused) { outgoingCallAudioRef.current.pause(); outgoingCallAudioRef.current.currentTime = 0; }
        };
        if (p2pCallState === 'receiving') { stopAll(); playIncoming(); }
        else if (p2pCallState === 'calling') { stopAll(); playOutgoing(); }
        else { stopAll(); }
        return stopAll; 
    }, [p2pCallState]);

    useEffect(() => {
        if (!currentUser || !db) return;
        const signalsQuery = query(collection(db, "signals"), where("to", "==", currentUser.uid));
        const unsubscribe = onSnapshot(signalsQuery, (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    const signal = JSON.parse(data.signal);
                    
                    if (data.type === 'p2p-call' && signal.type === 'offer' && callStateRef.current === 'idle') {
                        setIncomingCall({ fromId: data.from, fromName: data.fromName, fromAvatar: data.fromAvatar, chatId: data.chatId, signal: data.signal, });
                        setP2PCallState('receiving');
                    } else if (data.type === 'p2p-call' && signal.type === 'answer' && callStateRef.current === 'calling') {
                        p2pPeerRef.current?.signal(signal);
                    } else if (data.type === 'p2p-call' && signal.type === 'end-call') {
                         if (callStateRef.current !== 'idle') { toast({ title: 'Call Ended' }); endP2PCall(false); }
                    } else if (data.type === 'room-offer') {
                        if (!roomLocalStreamRef.current || !currentRoomId) return;
                        const peer = new Peer({ initiator: false, stream: roomLocalStreamRef.current, trickle: false, config: { iceServers } });
                        peer.on('signal', answer => sendSignal(data.from, currentRoomId, answer, 'room-answer'));
                        peer.on('stream', stream => setRoomRemoteStreams(prev => [...prev.filter(s => s.peerId !== data.from), { peerId: data.from, stream }]));
                        peer.on('close', () => setRoomRemoteStreams(prev => prev.filter(s => s.peerId !== data.from)));
                        peer.on('error', (err) => { console.error(`Peer error with ${data.from}:`, err); roomPeersRef.current[data.from]?.destroy(); delete roomPeersRef.current[data.from]; });
                        peer.signal(signal);
                        roomPeersRef.current[data.from] = peer;
                    } else if (data.type === 'room-answer') {
                        roomPeersRef.current[data.from]?.signal(signal);
                    } else if (p2pPeerRef.current && !p2pPeerRef.current.destroyed) {
                        p2pPeerRef.current?.signal(signal);
                    }
                    await deleteDoc(change.doc.ref);
                }
            });
        });
        return () => unsubscribe();
    }, [currentUser, toast, currentRoomId]);

    useEffect(() => {
        if (!currentUser || !db) return;
        const chatsQuery = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid), orderBy("lastUpdate", "desc"));
        const unsubscribe = onSnapshot(chatsQuery, async (snapshot) => {
            if (isInitialChatsLoad.current) { isInitialChatsLoad.current = false; }
            let unreadSum = 0;
            const enrichedChats = await Promise.all(snapshot.docs.map(async (chatDoc) => {
                const chat = { id: chatDoc.id, ...chatDoc.data() } as Chat;
                const otherId = chat.participants.find(p => p !== currentUser.uid) || '';
                const otherName = chat.participantNames?.[otherId] || 'User';
                const unreadCount = chat.unreadCounts?.[currentUser.uid] || 0;
                unreadSum += unreadCount;
                const userDoc = await getDoc(doc(db, "users", otherId));
                const otherAvatar = userDoc.exists() ? userDoc.data().photoURL || '' : '';
                return { ...chat, otherParticipant: { id: otherId, name: otherName, avatar: otherAvatar }, unreadCount };
            }));
            setConversations(enrichedChats); setTotalUnread(unreadSum);
        });
        return () => unsubscribe();
    }, [currentUser]);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    const getMicStream = async (): Promise<MediaStream | null> => {
        try {
            return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (error) {
            toast({ title: "Microphone Error", variant: "destructive" }); return null;
        }
    }
    const endP2PCall = async (notifyPeer = true) => {
        if (notifyPeer && p2pPeerRef.current?.destroyed === false && selectedChat && currentUser) {
            await sendSignal(selectedChat.otherParticipant.id, selectedChat.id, { type: 'end-call' }, 'p2p-call');
        }
        p2pPeerRef.current?.destroy(); p2pPeerRef.current = null;
        p2pLocalStreamRef.current?.getTracks().forEach(track => track.stop()); p2pLocalStreamRef.current = null;
        setP2PRemoteStream(null); setP2PCallState('idle'); setIsP2PMuted(false); setIncomingCall(null);
    };
    const startP2PCall = async (chat: EnrichedChat) => {
        if (!currentUser || !db) return;
        const stream = await getMicStream(); if (!stream) { setP2PCallState('idle'); return; }
        p2pLocalStreamRef.current = stream; setP2PCallState('calling');
        const peer = new Peer({ initiator: true, trickle: false, stream: stream, config: { iceServers } });
        p2pPeerRef.current = peer;
        peer.on('signal', (signal) => sendSignal(chat.otherParticipant.id, chat.id, signal, 'p2p-call'));
        peer.on('stream', (remoteStream) => { setP2PRemoteStream(remoteStream); setP2PCallState('active'); });
        peer.on('close', () => endP2PCall(false));
        peer.on('error', (err) => { toast({ title: "Call Error", variant: "destructive" }); endP2PCall(false); });
    };
    const answerP2PCall = async () => {
        if (!currentUser || !db || !incomingCall) return;
        const stream = await getMicStream(); if (!stream) { endP2PCall(false); declineP2PCall(); return; }
        p2pLocalStreamRef.current = stream;
        const peer = new Peer({ initiator: false, trickle: false, stream: stream, config: { iceServers } });
        p2pPeerRef.current = peer;
        const chatWithCaller = conversations.find(c => c.id === incomingCall.chatId); setSelectedChat(chatWithCaller || null);
        setP2PCallState('active');
        peer.on('signal', (signal) => sendSignal(incomingCall.fromId, incomingCall.chatId, signal, 'p2p-call'));
        peer.on('stream', (remoteStream) => setP2PRemoteStream(remoteStream));
        peer.on('close', () => endP2PCall(false));
        peer.on('error', (err) => endP2PCall(false));
        peer.signal(JSON.parse(incomingCall.signal));
        setIncomingCall(null);
    };
    const declineP2PCall = async () => {
        if (incomingCall) await sendSignal(incomingCall.fromId, incomingCall.chatId, { type: 'end-call' }, 'p2p-call');
        setIncomingCall(null); setP2PCallState('idle');
    };
    const toggleP2PMute = () => { if (p2pLocalStreamRef.current) { const track = p2pLocalStreamRef.current.getAudioTracks()[0]; if(track) {track.enabled = !track.enabled; setIsP2PMuted(!track.enabled);} } };
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault(); if (!db || !currentUser || !selectedChat || !newMessage.trim()) return;
        const otherId = selectedChat.participants.find(p => p !== currentUser.uid); if (!otherId) return;
        const chatDocRef = doc(db, "chats", selectedChat.id); const newMessageRef = doc(collection(db, "chats", selectedChat.id, "messages"));
        const batch = writeBatch(db); batch.set(newMessageRef, { text: newMessage, senderId: currentUser.uid, timestamp: serverTimestamp(), });
        batch.set(chatDocRef, { lastMessage: newMessage, lastUpdate: serverTimestamp(), participants: selectedChat.participants, participantNames: selectedChat.participantNames, unreadCounts: { [otherId]: increment(1), [currentUser.uid]: 0, } }, { merge: true });
        await batch.commit(); setNewMessage('');
    };
    const handleSelectChat = async (chat: EnrichedChat) => {
        if (!currentUser || !db) return; setSelectedChat(chat);
        if (chat.unreadCount > 0) { await setDoc(doc(db, "chats", chat.id), { unreadCounts: { [currentUser.uid]: 0 } }, { merge: true }); }
    };

    useEffect(() => { if (!isChatSheetOpen) setSelectedChat(null); }, [isChatSheetOpen]);

    const P2PCallDialog = () => {
        const otherParticipant = selectedChat?.otherParticipant;
        const title = p2pCallState === 'calling' ? `Calling ${otherParticipant?.name}...` : `In call with ${otherParticipant?.name}`;
        
        return (
            <Dialog open={p2pCallState === 'calling' || p2pCallState === 'active'} onOpenChange={(open) => !open && endP2PCall()}>
                <DialogContent>
                    <div className="flex flex-col items-center gap-6 p-8">
                        <p className="text-lg font-medium">{title}</p>
                        <Avatar className="h-24 w-24">
                            <AvatarImage src={otherParticipant?.avatar} />
                            <AvatarFallback>{otherParticipant?.name?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex items-center gap-4">
                            <Button variant={isP2pMuted ? "secondary" : "default"} size="icon" className="h-14 w-14 rounded-full" onClick={toggleP2PMute}>
                                {isP2pMuted ? <MicOff className="h-7 w-7"/> : <Mic className="h-7 w-7"/>}
                            </Button>
                            <Button variant="destructive" size="icon" className="h-14 w-14 rounded-full" onClick={() => endP2PCall()}>
                                <PhoneOff className="h-7 w-7"/>
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        );
    };

    return (
        <AudioRoomContext.Provider value={{ roomData, participants, speakingRequests, chatMessages: roomChatMessages, speakerInvitation, isMuted: roomIsMuted, myRole, canSpeak, hasRequested, elapsedTime, joinRoom, leaveRoom, promptToLeave, endRoomForAll, toggleMute, requestToSpeak, manageRequest, changeRole, acceptInvite, declineInvite, removeUser, selfPromoteToSpeaker, pinLink, unpinLink, updateRoomTitle, sendChatMessage, handlePictureUpload }}>
            {children}
            {roomRemoteStreams.map(rs => <AudioPlayer key={rs.peerId} stream={rs.stream} />)}
            {p2pRemoteStream && <AudioPlayer stream={p2pRemoteStream} />}
            <P2PCallDialog />
            <AlertDialog open={p2pCallState === 'receiving'}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Incoming Call</AlertDialogTitle>
                        <AlertDialogDescription>
                            {incomingCall?.fromName} is calling you.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                     <div className="flex justify-center py-4">
                        <Avatar className="h-24 w-24">
                            <AvatarImage src={incomingCall?.fromAvatar} />
                            <AvatarFallback>{incomingCall?.fromName?.[0]}</AvatarFallback>
                        </Avatar>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={declineP2PCall}>Decline</AlertDialogCancel>
                        <AlertDialogAction onClick={answerP2PCall}>Accept</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {currentUser && (
            <Sheet open={isChatSheetOpen} onOpenChange={setIsChatSheetOpen}>
                <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="fixed bottom-6 left-6 z-40 h-16 w-16 rounded-full shadow-lg">
                        <MessageSquare className="h-8 w-8"/>
                        {totalUnread > 0 && (
                             <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                                {totalUnread}
                            </span>
                        )}
                    </Button>
                </SheetTrigger>
                <SheetContent className="flex flex-col p-0" side="left">
                    {selectedChat ? (
                        <>
                            <SheetHeader className="p-4 border-b flex-row items-center gap-4 space-y-0">
                                <Button variant="ghost" size="icon" onClick={() => setSelectedChat(null)}><ArrowLeft/></Button>
                                <Avatar><AvatarImage src={selectedChat.otherParticipant.avatar} /><AvatarFallback>{selectedChat.otherParticipant.name[0]}</AvatarFallback></Avatar>
                                <SheetTitle className="flex-1">{selectedChat.otherParticipant.name}</SheetTitle>
                                <Button variant="ghost" size="icon" onClick={() => startP2PCall(selectedChat)} disabled={p2pCallState !== 'idle'}><Phone/></Button>
                            </SheetHeader>
                            <ScrollArea className="flex-1 px-4">
                                <div className="py-4 space-y-4">
                                    {messages.map(message => (
                                         <div key={message.id} className={cn("flex w-max max-w-xs flex-col gap-1 rounded-lg px-3 py-2 text-sm",
                                            message.senderId === currentUser?.uid ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                                        )}>
                                            {message.text}
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>
                            </ScrollArea>
                            <SheetFooter className="p-4 border-t">
                                <form onSubmit={handleSendMessage} className="flex w-full items-center space-x-2">
                                    <Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." autoComplete="off"/>
                                    <Button type="submit" size="icon" disabled={!newMessage.trim()}><Send/></Button>
                                </form>
                            </SheetFooter>
                        </>
                    ) : (
                        <>
                            <SheetHeader className="p-4 border-b">
                                <SheetTitle>Messages</SheetTitle>
                            </SheetHeader>
                            <ScrollArea className="flex-1">
                                {conversations.map(chat => (
                                    <button key={chat.id} onClick={() => handleSelectChat(chat)} className="flex items-center gap-4 p-4 w-full text-left hover:bg-accent">
                                        <Avatar><AvatarImage src={chat.otherParticipant.avatar}/><AvatarFallback>{chat.otherParticipant.name[0]}</AvatarFallback></Avatar>
                                        <div className="flex-1 overflow-hidden">
                                            <p className="font-semibold truncate">{chat.otherParticipant.name}</p>
                                            <p className="text-sm text-muted-foreground truncate">{chat.lastMessage}</p>
                                        </div>
                                        {chat.unreadCount > 0 && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{chat.unreadCount}</span>}
                                    </button>
                                ))}
                            </ScrollArea>
                        </>
                    )}
                </SheetContent>
            </Sheet>
            )}

             {showFloatingPlayer && roomData && (
                <Card className="fixed bottom-6 right-6 z-50 w-80 shadow-lg animate-in fade-in slide-in-from-bottom-10">
                    <CardContent className="p-3 flex items-center gap-2">
                        <div className="flex-1 overflow-hidden">
                            <p className="font-semibold truncate">{roomData.title}</p>
                            <p className="text-sm text-muted-foreground">Listening in background...</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={toggleMute}>
                            {roomIsMuted ? <MicOff className="h-5 w-5"/> : <Mic className="h-5 w-5"/>}
                        </Button>
                        <Button variant="ghost" size="icon" asChild>
                            <Link href={`/sound-sphere/${roomData.id}`}>
                                <ArrowRight className="h-5 w-5"/>
                            </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => leaveRoom({navigate: false})}>
                            <X className="h-5 w-5"/>
                        </Button>
                    </CardContent>
                </Card>
            )}
        </AudioRoomContext.Provider>
    );
}
