
"use client";

import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, doc, addDoc, serverTimestamp, setDoc, getDoc, updateDoc, increment, writeBatch } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, ArrowLeft } from 'lucide-react';
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
            }
        });
        return () => unsubscribe();
    }, []);

    // Fetch and enrich conversations when user is logged in
    useEffect(() => {
        if (!currentUser || !db) return;

        const chatsQuery = query(
            collection(db, "chats"),
            where("participants", "array-contains", currentUser.uid),
            orderBy("lastUpdate", "desc")
        );

        const unsubscribe = onSnapshot(chatsQuery, async (snapshot) => {

            if (!isInitialChatsLoad.current) {
                const hasNewMessageForMe = snapshot.docChanges().some(change => {
                    if (change.type === 'modified') {
                        const oldChat = conversationsRef.current.find(c => c.id === change.doc.id);
                        const oldUnread = oldChat?.unreadCount || 0;
                        const newUnread = change.doc.data().unreadCounts?.[currentUser.uid] || 0;
                        
                        return newUnread > oldUnread && selectedChatRef.current?.id !== change.doc.id;
                    }
                    return false;
                });

                if (hasNewMessageForMe) {
                    playMessageSound();
                }
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
                    const userDoc = await getDoc(doc(db, "users", otherId));
                    if (userDoc.exists()) {
                        otherAvatar = userDoc.data().photoURL || '';
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
            
            if (isInitialChatsLoad.current) {
                isInitialChatsLoad.current = false;
            }

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


    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser || !selectedChat || !newMessage.trim()) return;

        const otherId = selectedChat.participants.find(p => p !== currentUser.uid);
        if (!otherId) return;

        const chatDocRef = doc(db, "chats", selectedChat.id);
        const messagesRef = collection(db, "chats", selectedChat.id, "messages");
        
        try {
            // Add the new message document
            await addDoc(messagesRef, {
                text: newMessage,
                senderId: currentUser.uid,
                timestamp: serverTimestamp(),
            });

            // Use set with merge to safely create/update the main chat document.
            // This prevents errors if the document or 'unreadCounts' field doesn't exist yet.
            await setDoc(chatDocRef, {
                    lastMessage: newMessage,
                    lastUpdate: serverTimestamp(),
                    participants: selectedChat.participants,
                    participantNames: selectedChat.participantNames,
                    unreadCounts: {
                        [otherId]: increment(1),
                        [currentUser.uid]: 0
                    }
                }, { merge: true }
            );

            setNewMessage('');
        } catch (error) {
            console.error("Error sending message:", error);
            toast({ title: "Error", description: "Could not send message.", variant: "destructive" });
        }
    };
    
    const handleSelectChat = async (chat: EnrichedChat) => {
        if (!currentUser || !db) return;
        
        setSelectedChat(chat); // Select the chat immediately for better UX

        // If the chat has unread messages, mark them as read in Firestore.
        if (chat.unreadCount > 0) {
            try {
                const chatDocRef = doc(db, "chats", chat.id);
                 // Use set with merge to safely update the count, even if the field doesn't exist.
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

    // Don't render anything if the user is not logged in
    if (!currentUser) return null;

    return (
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
                                        chat.unreadCount > 0 && "bg-accent/50 hover:bg-accent/80"
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
    );
}
