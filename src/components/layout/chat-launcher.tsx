
"use client";

import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, doc, addDoc, serverTimestamp, setDoc, getDoc, updateDoc, increment, writeBatch, deleteDoc } from 'firebase/firestore';
import Peer from 'simple-peer';
import type { Instance as PeerInstance } from 'simple-peer';
import 'webrtc-adapter';

import { db, auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent as AlertDialogContentComponent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader as AlertDialogHeaderComponent, AlertDialogTitle as AlertDialogTitleComponent } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, ArrowLeft, Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
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

const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: "stun:stun.ekiga.net" },
    { urls: "stun:stun.ideasip.com" },
    { urls: "stun:stun.voiparound.com" },
];

const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
    const ref = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (ref.current) {
            ref.current.srcObject = stream;
        }
    }, [stream]);

    return <audio ref={ref} autoPlay playsInline />;
};

// A new self-contained component for the chat launcher
export function ChatLauncher() {
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

        const handleBeforeUnload = () => {
            if (callStateRef.current !== 'idle') {
                endCall(false);
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            unsubscribe();
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);

    // Call sound effect
    useEffect(() => {
        if (typeof window === 'undefined') return;

        // Lazily create Audio elements
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
        
        // Cleanup on component unmount
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
                    
                    // Delete signal doc after processing
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

                    // It's a new message for me if the unread count increased and I'm not looking at that chat
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
                
                // Get the other participant's name and avatar
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
            } else {
                 toast({
                    title: "Error loading chats",
                    description: "Could not retrieve your conversations.",
                    variant: "destructive",
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
    
    // Auto-scroll to the latest message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Listen for custom event to open a chat
    useEffect(() => {
        const handleOpenChat = async (event: Event) => {
            if (!currentUser || !db) return;

            const customEvent = event as CustomEvent<{ userId: string }>;
            const { userId } = customEvent.detail;

            // Find if a conversation already exists in our state
            const existingChat = conversations.find(c => c.otherParticipant.id === userId);

            if (existingChat) {
                handleSelectChat(existingChat);
            } else {
                // If it doesn't exist, we create a "virtual" chat object to select it.
                // The real document will be created when the first message is sent.
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
            if (navigator.permissions) {
                const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                if (permissionStatus.state === 'denied') {
                    toast({
                        title: "Microphone Access Denied",
                        description: "Please enable microphone permissions in your browser settings to make or receive calls.",
                        variant: "destructive",
                        duration: 10000
                    });
                    return null;
                }
            }
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
        if (callState !== 'idle') {
            toast({ title: "Cannot start call", description: "You are already in a call or one is incoming.", variant: "destructive" });
            return;
        }
        
        const stream = await getMicStream();
        if (!stream) {
            setCallState('idle');
            return;
        }
        localStreamRef.current = stream;
        setCallState('calling');
        
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream: stream,
            config: { iceServers }
        });
        peerRef.current = peer;

        peer.on('signal', (signal) => {
            sendSignal(chat.otherParticipant.id, chat.id, signal);
        });
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
        
        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream: stream,
            config: { iceServers }
        });
        peerRef.current = peer;
        
        const chatWithCaller = conversations.find(c => c.id === incomingCall.chatId);
        setSelectedChat(chatWithCaller || null);
        setCallState('active');
        
        peer.on('signal', (signal) => {
            sendSignal(incomingCall.fromId, incomingCall.chatId, signal);
        });
        peer.on('stream', (remoteStream) => {
            setRemoteStream(remoteStream);
        });
        peer.on('close', () => endCall(false));
        peer.on('error', (err) => {
             console.error('Peer error:', err);
             toast({ title: "Call Error", description: "An error occurred during the call.", variant: "destructive" });
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
             // Create a batch write
            const batch = writeBatch(db);

            // Add the new message
            const newMessageRef = doc(collection(db, "chats", selectedChat.id, "messages"));
            batch.set(newMessageRef, {
                text: newMessage,
                senderId: currentUser.uid,
                timestamp: serverTimestamp(),
            });

            // Update the chat document
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
                const chatDocRef = doc(db, "chats", chat.id);
                // Use set with merge to avoid overwriting the whole document
                await setDoc(chatDocRef, {
                    unreadCounts: {
                        [currentUser.uid]: 0
                    }
                }, { merge: true });
            } catch (error) {
                console.warn("Could not mark chat as read", error);
            }
        }
    };

    
    // Reset view when closing the sheet
    useEffect(() => {
        if (!isOpen) {
            setSelectedChat(null);
        }
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
                    <DialogHeader>
                         <DialogTitle className="sr-only">Voice call with {name}</DialogTitle>
                        <DialogDescription className="sr-only">An active voice call. You can mute your microphone or end the call.</DialogDescription>
                    </DialogHeader>
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
                <AlertDialogContentComponent>
                    <AlertDialogHeaderComponent className="items-center">
                         <Avatar className="h-20 w-20">
                            <AvatarImage src={incomingCall?.fromAvatar} alt={incomingCall?.fromName}/>
                            <AvatarFallback className="text-2xl">{incomingCall?.fromName?.[0]}</AvatarFallback>
                        </Avatar>
                        <AlertDialogTitleComponent>{incomingCall?.fromName} is calling</AlertDialogTitleComponent>
                        <AlertDialogDescriptionComponent>
                            Do you want to accept the call?
                        </AlertDialogDescriptionComponent>
                    </AlertDialogHeaderComponent>
                    <AlertDialogFooter className="justify-center">
                        <AlertDialogCancel asChild>
                            <Button variant="destructive" size="lg" className="rounded-full" onClick={declineCall}>Decline</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button variant="default" size="lg" className="rounded-full bg-green-600 hover:bg-green-700" onClick={answerCall}>Accept</Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContentComponent>
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
                        // Message View
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
                        // Conversation List View
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
