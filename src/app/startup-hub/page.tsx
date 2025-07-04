
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from "firebase/firestore";

import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Target, CheckCircle2, Bot, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from "@/lib/firebase";
import { startupConsultant } from '@/ai/flows/startup-consultant-flow';

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

export default function StartupHubPage() {
    const { toast } = useToast();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [startup, setStartup] = useState<Startup | null>(null);
    const [courses, setCourses] = useState<Course[]>([]);
    
    // AI Consultant state
    const [consultantQuery, setConsultantQuery] = useState('');
    const [consultantResponse, setConsultantResponse] = useState('');
    const [isConsultantLoading, setIsConsultantLoading] = useState(false);

    useEffect(() => {
        if (!auth || !db) {
            router.push('/');
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists() && userDocSnap.data().startupId) {
                    const startupId = userDocSnap.data().startupId;
                    const startupDocRef = doc(db, "startups", startupId);
                    const startupDocSnap = await getDoc(startupDocRef);
                    if (startupDocSnap.exists()) {
                        setStartup({ id: startupDocSnap.id, ...startupDocSnap.data() } as Startup);
                        setIsAuthorized(true);
                        fetchCourses();
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
    
    const handleConsultantSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!consultantQuery.trim()) return;

        setIsConsultantLoading(true);
        setConsultantResponse('');
        try {
            const response = await startupConsultant(consultantQuery);
            setConsultantResponse(response);
        } catch (error) {
            console.error("Error with AI consultant:", error);
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
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Bot className="h-6 w-6 text-primary" /> AI Startup Consultant</CardTitle>
                            <CardDescription>Ask for advice on strategy, marketing, product, or any other business challenge.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <form onSubmit={handleConsultantSubmit} className="space-y-4">
                                <Textarea 
                                    placeholder="e.g., What are some effective low-budget marketing strategies for a new SaaS product?" 
                                    value={consultantQuery}
                                    onChange={e => setConsultantQuery(e.target.value)}
                                    rows={4}
                                />
                                <Button type="submit" disabled={isConsultantLoading || !consultantQuery.trim()}>
                                    {isConsultantLoading ? 'Thinking...' : 'Ask Consultant'}
                                </Button>
                            </form>
                            
                            {(isConsultantLoading || consultantResponse) && (
                                <Card className="bg-muted/50">
                                    <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary"/>Consultant's Advice</CardTitle></CardHeader>
                                    <CardContent>
                                        {isConsultantLoading ? (
                                             <div className="space-y-2"><div className="animate-pulse bg-muted-foreground/20 h-4 w-full rounded-md"></div><div className="animate-pulse bg-muted-foreground/20 h-4 w-5/6 rounded-md"></div><div className="animate-pulse bg-muted-foreground/20 h-4 w-3/4 rounded-md"></div></div>
                                        ) : (
                                            <p className="whitespace-pre-wrap">{consultantResponse}</p>
                                        )}
                                    </CardContent>
                                </Card>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </SubpageLayout>
    );
}
