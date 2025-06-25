
"use client";

import { useState, useEffect } from 'react';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CheckCircle, Circle, Clock, PlusCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { collection, addDoc, getDocs, serverTimestamp, query, where } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useToast } from '@/hooks/use-toast';


const team = [
    { name: "Alice Mayer", role: "Project Manager", avatar: "https://placehold.co/48x48.png" },
    { name: "Bob Ross", role: "Lead Frontend Developer", avatar: "https://placehold.co/48x48.png" },
    { name: "Charlie Day", role: "Lead Backend Developer", avatar: "https://placehold.co/48x48.png" },
    { name: "Diana Prince", role: "UI/UX Designer", avatar: "https://placehold.co/48x48.png" },
];

const timeline = [
    { name: "Phase 1: Discovery & Planning", status: "Completed" },
    { name: "Phase 2: UI/UX Design", status: "Completed" },
    { name: "Phase 3: Frontend Development", status: "In Progress" },
    { name: "Phase 4: Backend Development", status: "In Progress" },
    { name: "Phase 5: Testing & QA", status: "Upcoming" },
    { name: "Phase 6: Deployment", status: "Upcoming" },
]

interface Ticket {
    id: string;
    subject: string;
    status: string;
    lastUpdate: any;
}

export default function CorpHubPage() {
    const { toast } = useToast();
    const [user, setUser] = useState<User | null>(null);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [newTicketSubject, setNewTicketSubject] = useState('');
    const [newTicketDescription, setNewTicketDescription] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);

     useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                fetchTickets(currentUser.uid);
            } else {
                setTickets([]);
            }
        });
        return () => unsubscribe();
    }, []);

    const fetchTickets = async (userId: string) => {
        if (!db) return;
        try {
            const q = query(collection(db, "tickets"), where("userId", "==", userId));
            const querySnapshot = await getDocs(q);
            const ticketsList = querySnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    subject: data.subject,
                    status: data.status,
                    lastUpdate: data.lastUpdate?.toDate ? data.lastUpdate.toDate().toLocaleDateString() : 'N/A',
                }
            }) as Ticket[];
            setTickets(ticketsList);
        } catch (error) {
            console.error("Error fetching tickets: ", error);
        }
    };

    const handleNewTicketSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !user) {
             toast({ title: "Error", description: "You must be logged in to create a ticket.", variant: "destructive" });
            return;
        }
        if(!newTicketSubject || !newTicketDescription) {
            toast({ title: "Error", description: "Please fill all fields.", variant: "destructive" });
            return;
        }

        try {
            await addDoc(collection(db, "tickets"), {
                subject: newTicketSubject,
                description: newTicketDescription,
                status: "Open",
                lastUpdate: serverTimestamp(),
                userId: user.uid,
                userEmail: user.email,
            });
            toast({ title: "Success", description: "Ticket created successfully." });
            setNewTicketSubject('');
            setNewTicketDescription('');
            setIsDialogOpen(false);
            fetchTickets(user.uid); // Refresh list
        } catch (error) {
             console.error("Error creating ticket: ", error);
             toast({ title: "Error", description: "Failed to create ticket.", variant: "destructive" });
        }
    }

    return (
        <SubpageLayout title="Corporate Hub">
            <Tabs defaultValue="dashboard" className="w-full">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                    <TabsTrigger value="tickets" disabled={!user}>Tickets</TabsTrigger>
                    <TabsTrigger value="team">Team</TabsTrigger>
                </TabsList>
                <TabsContent value="dashboard" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Timeline</CardTitle>
                            <CardDescription>High-level overview of the project phases.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {timeline.map(item => (
                                    <div key={item.name} className="flex items-center gap-4">
                                        <div>
                                            {item.status === 'Completed' ? <CheckCircle className="h-6 w-6 text-green-500" /> :
                                             item.status === 'In Progress' ? <Clock className="h-6 w-6 text-blue-500 animate-spin" /> :
                                             <Circle className="h-6 w-6 text-muted-foreground" />
                                            }
                                        </div>
                                        <p className="font-medium">{item.name}</p>
                                        <Badge variant="outline" className="ml-auto">{item.status}</Badge>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="tickets" className="mt-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                           <div>
                             <CardTitle>Support Tickets</CardTitle>
                             <CardDescription>Manage your modification requests and bug reports.</CardDescription>
                           </div>
                           <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button disabled={!user}><PlusCircle className="mr-2 h-4 w-4"/>New Ticket</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Create a new support ticket</DialogTitle>
                                        <DialogDescription>
                                            Describe your issue or request below. Our team will get back to you shortly.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <form onSubmit={handleNewTicketSubmit}>
                                        <div className="grid gap-4 py-4">
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="subject" className="text-right">Subject</Label>
                                                <Input id="subject" value={newTicketSubject} onChange={(e) => setNewTicketSubject(e.target.value)} className="col-span-3" />
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="description" className="text-right">Description</Label>
                                                <Textarea id="description" value={newTicketDescription} onChange={(e) => setNewTicketDescription(e.target.value)} className="col-span-3" />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button type="submit">Submit Ticket</Button>
                                        </DialogFooter>
                                    </form>
                                </DialogContent>
                           </Dialog>
                        </CardHeader>
                        <CardContent>
                             {user ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Ticket ID</TableHead>
                                            <TableHead>Subject</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Last Update</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {tickets.map(ticket => (
                                            <TableRow key={ticket.id}>
                                                <TableCell className="font-mono">{ticket.id.substring(0,6)}...</TableCell>
                                                <TableCell className="font-medium">{ticket.subject}</TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={ticket.status === 'Completed' ? 'default' : ticket.status === 'In Progress' ? 'secondary' : 'destructive'}
                                                        className={ticket.status === 'Completed' ? 'bg-green-500/20 text-green-700' : ticket.status === 'In Progress' ? 'bg-blue-500/20 text-blue-700' : 'bg-yellow-500/20 text-yellow-700'}
                                                    >
                                                        {ticket.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{ticket.lastUpdate}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="text-center text-muted-foreground">Please log in to view your tickets.</p>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="team" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Your Project Team</CardTitle>
                            <CardDescription>The dedicated professionals from Infinity Software working on your project.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                            {team.map(member => (
                                <div key={member.name} className="flex items-center gap-4">
                                    <Avatar className="h-12 w-12">
                                        <AvatarImage src={member.avatar} data-ai-hint="person professional"/>
                                        <AvatarFallback>{member.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="font-semibold">{member.name}</p>
                                        <p className="text-sm text-muted-foreground">{member.role}</p>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </SubpageLayout>
    );
}
