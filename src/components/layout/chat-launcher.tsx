
"use client";

import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, doc, addDoc, serverTimestamp, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Interfaces for our data structures
interface Chat {
    id: string;
    participantNames: { [key: string]: string };
    participants: string[];
    lastMessage: string;
    lastUpdate: any;
}

interface EnrichedChat extends Chat {
    otherParticipant: {
        id: string;
        name: string;
        avatar: string;
    };
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
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [selectedChat, setSelectedChat] = useState<EnrichedChat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
            const chatsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chat));
            
            const enrichedChats = await Promise.all(chatsData.map(async (chat) => {
                const otherId = chat.participants.find(p => p !== currentUser.uid) || '';
                const otherName = chat.participantNames?.[otherId] || 'User';

                let otherAvatar = '';
                if (otherId) {
                    const userDoc = await getDoc(doc(db, "users", otherId));
                    if (userDoc.exists()) {
                        otherAvatar = userDoc.data().photoURL || '';
                    }
                }

                return {
                    ...chat,
                    otherParticipant: { id: otherId, name: otherName, avatar: otherAvatar }
                };
            }));
            
            setConversations(enrichedChats);
        });

        return () => unsubscribe();
    }, [currentUser]);

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

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser || !selectedChat || !newMessage.trim()) return;

        const messagesRef = collection(db, "chats", selectedChat.id, "messages");
        await addDoc(messagesRef, {
            text: newMessage,
            senderId: currentUser.uid,
            timestamp: serverTimestamp(),
        });
        
        const chatDocRef = doc(db, "chats", selectedChat.id);
        await setDoc(chatDocRef, {
            lastMessage: newMessage,
            lastUpdate: serverTimestamp(),
        }, { merge: true });

        setNewMessage('');
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
                        <div className="p-2 space-y-1">
                            {conversations.length > 0 ? conversations.map(chat => (
                                <button 
                                    key={chat.id} 
                                    onClick={() => setSelectedChat(chat)}
                                    className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-muted"
                                >
                                    <Avatar>
                                        <AvatarImage src={chat.otherParticipant.avatar} />
                                        <AvatarFallback>{chat.otherParticipant.name?.[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 truncate">
                                        <p className="font-semibold">{chat.otherParticipant.name}</p>
                                        <p className="text-sm text-muted-foreground truncate">{chat.lastMessage}</p>
                                    </div>
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
