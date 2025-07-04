"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, query, orderBy, serverTimestamp, writeBatch } from "firebase/firestore";

import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Target, CheckCircle2, Bot, Send, User as UserIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from "@/lib/firebase";
import { startupConsultant } from '@/ai/flows/startup-consultant-flow';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';


const deadlines = [
    { task: "User Authentication Flow", due: "3 days", status: "In Progress" },
    { task: "Payment Gateway Integration", due: "1 week", status: "Not Started" },
    { task: "Mobile App Beta Release", due: "3 weeks", status: "Not Started" },
];

interface Course {
    id: string;
    title: string;
    description: string;
}

interface Startup {
    id: string;
    name: string;
}

interface ConsultantMessage {
    role: 'user' | 'assistant';
    content: string;
}

export default function StartupHubPage() {
    const { toast } = useToast();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [startup, setStartup] = useState<Startup | null>(null);
    const [courses, setCourses] = useState<Course[]>([]);
    const [user, setUser] = useState<User | null>(null);
    
    // AI Consultant state
    const [consultantMessages, setConsultantMessages] = useState<ConsultantMessage[]>([]);
    const [consultantQuery, setConsultantQuery] = useState('');
    const [isConsultantLoading, setIsConsultantLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);


    useEffect(() => {
        if (!auth || !db) {
            router.push('/');
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                const userDocRef = doc(db, "users", currentUser.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists() && userDocSnap.data().startupId) {
                    const startupId = userDocSnap.data().startupId;
                    const startupDocRef = doc(db, "startups", startupId);
                    const startupDocSnap = await getDoc(startupDocRef);
                    if (startupDocSnap.exists()) {
                        setStartup({ id: startupDocSnap.id, ...startupDocSnap.data() } as Startup);
                        setIsAuthorized(true);
                        fetchCourses();
                        fetchConsultantHistory(currentUser.uid);
                    } else {
                         toast({ title: "Error", description: "Associated startup not found.", variant: "destructive" });
                         router.push('/');
                    }
                } else {
                    toast({ title: "Access Denied", description: "You are not associated with any startup.", variant: "destructive" });
                    router.push('/');
                }
            } else {
                toast({ title: "Authentication Required", description: "Please log in to access the startup hub.", variant: "destructive" });
                router.push('/');
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [router, toast]);
    
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [consultantMessages, isConsultantLoading]);

    const fetchCourses = async () => {
        if (!db) return;
        try {
            const querySnapshot = await getDocs(collection(db, "courses"));
            const coursesList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Course[];
            setCourses(coursesList);
        } catch (error) {
            console.error("Error fetching courses: ", error);
        }
    };

    const fetchConsultantHistory = async (userId: string) => {
        if (!db) return;
        const messagesRef = collection(db, "users", userId, "consultantMessages");
        const q = query(messagesRef, orderBy("createdAt", "asc"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            setConsultantMessages([
                { role: 'assistant', content: 'Hello! I am your AI startup consultant. How can I help you today?' }
            ]);
        } else {
            const history = querySnapshot.docs.map(doc => doc.data() as ConsultantMessage);
            setConsultantMessages(history);
        }
    };
    
    const handleConsultantSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!consultantQuery.trim() || isConsultantLoading || !user) return;

        const userMessage: ConsultantMessage = { role: 'user', content: consultantQuery };
        setConsultantMessages(prev => [...prev, userMessage]);
        
        const currentQuery = consultantQuery;
        setConsultantQuery('');
        setIsConsultantLoading(true);

        try {
            const response = await startupConsultant(currentQuery);
            const assistantMessage: ConsultantMessage = { role: 'assistant', content: response };
            setConsultantMessages(prev => [...prev, assistantMessage]);

            if (db) {
                const batch = writeBatch(db);
                const userMsgRef = doc(collection(db, "users", user.uid, "consultantMessages"));
                batch.set(userMsgRef, { ...userMessage, createdAt: serverTimestamp() });
                
                const assistantMsgRef = doc(collection(db, "users", user.uid, "consultantMessages"));
                batch.set(assistantMsgRef, { ...assistantMessage, createdAt: serverTimestamp() });

                await batch.commit();
            }

        } catch (error) {
            console.error("Error with AI consultant:", error);
            const errorMessage = "I'm having trouble connecting right now. Please try again in a moment.";
            setConsultantMessages(prev => [...prev, { role: 'assistant', content: errorMessage }]);
            toast({ title: "AI Error", description: "Could not get a response from the consultant.", variant: "destructive" });
        } finally {
            setIsConsultantLoading(false);
        }
    };

    if (isLoading) {
        return <SubpageLayout title="Startup Hub"><div className="flex justify-center items-center h-full"><p>Verifying access...</p></div></SubpageLayout>;
    }

    if (!isAuthorized || !startup) {
        return null;
    }

    return (
        <SubpageLayout title={`${startup.name} Hub`}>
             <Tabs defaultValue="dashboard" className="w-full">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                    <TabsTrigger value="courses">Courses</TabsTrigger>
                    <TabsTrigger value="consultant">AI Consultant</TabsTrigger>
                </TabsList>
                
                <TabsContent value="dashboard" className="mt-6 grid gap-8">
                    <Card>
                        <CardHeader><CardTitle>Project Advancement</CardTitle><CardDescription>Your project is currently 75% complete.</CardDescription></CardHeader>
                        <CardContent><Progress value={75} className="w-full" /></CardContent>
                    </Card>

                    <div className="grid gap-8 md:grid-cols-3">
                        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Tasks Completed</CardTitle><CheckCircle2 className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">42</div><p className="text-xs text-muted-foreground">/ 56 total tasks</p></CardContent></Card>
                        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Active Sprints</CardTitle><Target className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">2</div><p className="text-xs text-muted-foreground">Sprint #4 and #5</p></CardContent></Card>
                        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Next Milestone</CardTitle><BookOpen className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">Public Beta</div><p className="text-xs text-muted-foreground">Scheduled for next month</p></CardContent></Card>
                    </div>

                    <Card>
                        <CardHeader><CardTitle>Upcoming Deadlines</CardTitle></CardHeader>
                        <CardContent><Table><TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Due In</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{deadlines.map(d => (<TableRow key={d.task}><TableCell className="font-medium">{d.task}</TableCell><TableCell>{d.due}</TableCell><TableCell><Badge variant={d.status === 'In Progress' ? 'default' : 'secondary'} className="bg-accent text-accent-foreground">{d.status}</Badge></TableCell></TableRow>))}</TableBody></Table></CardContent>
                    </Card>
                </TabsContent>
                
                <TabsContent value="courses" className="mt-6">
                    <h2 className="text-2xl font-headline font-semibold tracking-tight mb-4">Startup Courses</h2>
                    <div className="grid gap-6 md:grid-cols-3">
                        {courses.map(course => (
                             <Card key={course.id}>
                                <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary"/>{course.title}</CardTitle></CardHeader>
                                <CardContent><p className="text-sm text-muted-foreground">{course.description}</p></CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                 <TabsContent value="consultant" className="mt-6">
                    <Card className="flex flex-col h-[70vh]">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Bot className="h-6 w-6 text-primary" /> AI Startup Consultant</CardTitle>
                            <CardDescription>Your personal AI advisor for strategy, marketing, and growth. Your conversation history is saved.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 p-0">
                           <ScrollArea className="h-full w-full">
                                <div className="space-y-6 p-6">
                                {consultantMessages.map((message, index) => (
                                    <div key={index} className={cn("flex items-start gap-3 w-full", message.role === 'user' ? 'justify-end' : 'justify-start')}>
                                        {message.role === 'assistant' && (
                                            <Avatar className="h-8 w-8 border">
                                                <AvatarFallback><Bot className="h-5 w-5 text-primary"/></AvatarFallback>
                                            </Avatar>
                                        )}
                                        <div className={cn(
                                            "max-w-xl rounded-lg p-3 text-sm",
                                            message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                                        )}>
                                            <p className="whitespace-pre-wrap">{message.content}</p>
                                        </div>
                                        {message.role === 'user' && (
                                            <Avatar className="h-8 w-8 border">
                                                <AvatarFallback><UserIcon className="h-5 w-5 text-primary"/></AvatarFallback>
                                            </Avatar>
                                        )}
                                    </div>
                                ))}
                                {isConsultantLoading && (
                                    <div className="flex items-start gap-3">
                                        <Avatar className="h-8 w-8 border">
                                            <AvatarFallback><Bot className="h-5 w-5 text-primary"/></AvatarFallback>
                                        </Avatar>
                                        <div className="bg-muted rounded-lg p-3">
                                            <div className="flex items-center justify-center gap-1.5 py-1">
                                                <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse delay-0"></span>
                                                <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse [animation-delay:0.2s]"></span>
                                                <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse [animation-delay:0.4s]"></span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                                </div>
                            </ScrollArea>
                        </CardContent>
                        <div className="p-4 border-t bg-background">
                            <form onSubmit={handleConsultantSubmit} className="flex items-start gap-2">
                                <Textarea 
                                    placeholder="Ask about marketing, strategy, funding..." 
                                    value={consultantQuery}
                                    onChange={e => setConsultantQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleConsultantSubmit(e as any);
                                        }
                                    }}
                                    rows={1}
                                    className="flex-1 resize-none"
                                />
                                <Button type="submit" size="icon" disabled={isConsultantLoading || !consultantQuery.trim()}>
                                    <Send className="h-4 w-4" />
                                </Button>
                            </form>
                        </div>
                    </Card>
                </TabsContent>
            </Tabs>
        </SubpageLayout>
    );
}
