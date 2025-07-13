
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Briefcase, Ticket, Building2, UserCog, Trash2, PlusCircle, User, Users, MoreVertical, Edit, KeyRound } from "lucide-react";
import { collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, where, query, setDoc, writeBatch } from "firebase/firestore";
import { onAuthStateChanged, createUserWithEmailAndPassword, updatePassword } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";


// Types
interface Course {
    id: string;
    title: string;
    description: string;
    videoUrl?: string;
}

interface Project {
    id: string;
    title: string;
    startup: string;
    remuneration: string;
}

interface Ticket {
    id: string;
    subject: string;
    status: string;
    lastUpdate: any;
}

interface Startup {
    id: string;
    name: string;
    founderId: string;
    founderName: string;
    founderEmail: string;
    members: number;
}

interface User {
    uid: string;
    firstName: string;
    lastName: string;
    email: string;
}

interface StartupUser extends User {
    startupId: string;
    startupName: string;
}

export default function AdminDashboardPage() {
    const { toast } = useToast();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);
    
    // Data states
    const [courses, setCourses] = useState<Course[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [startups, setStartups] = useState<Startup[]>([]);
    const [startupToDelete, setStartupToDelete] = useState<Startup | null>(null);
    const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
    const [newCredentials, setNewCredentials] = useState<{email: string, password: string} | null>(null);

    // Form states
    const [courseTitle, setCourseTitle] = useState('');
    const [courseDescription, setCourseDescription] = useState('');
    const [courseVideoUrl, setCourseVideoUrl] = useState('');
    const [projectTitle, setProjectTitle] = useState('');
    const [projectStartupId, setProjectStartupId] = useState('');
    const [projectDescription, setProjectDescription] = useState('');
    const [remuneration, setRemuneration] = useState('');
    const [skills, setSkills] = useState('');
    
    // Add Startup Dialog
    const [isAddStartupDialogOpen, setIsAddStartupDialogOpen] = useState(false);
    const [newStartupName, setNewStartupName] = useState('');
    const [newFounderFirstName, setNewFounderFirstName] = useState('');
    const [newFounderLastName, setNewFounderLastName] = useState('');
    const [newFounderEmail, setNewFounderEmail] = useState('');
    
    // Edit Startup Dialog
    const [isEditStartupDialogOpen, setIsEditStartupDialogOpen] = useState(false);
    const [startupToEdit, setStartupToEdit] = useState<Startup | null>(null);
    const [editedStartupName, setEditedStartupName] = useState('');
    const [editedStartupMembers, setEditedStartupMembers] = useState(1);


     useEffect(() => {
        if (!auth || !db) { router.push('/'); return; }
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists() && userDocSnap.data().is_admin === true) {
                    setIsAuthorized(true);
                    fetchAllData();
                } else {
                    toast({ title: "Access Denied", variant: "destructive" });
                    router.push('/');
                }
            } else {
                toast({ title: "Authentication Required", variant: "destructive" });
                router.push('/');
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [router, toast]);

    const fetchAllData = () => {
        fetchCourses();
        fetchProjects();
        fetchTickets();
        fetchStartups();
    };

    const fetchGeneric = async <T>(collectionName: string, setter: React.Dispatch<React.SetStateAction<T[]>>) => {
        if (!db) return;
        try {
            const querySnapshot = await getDocs(collection(db, collectionName));
            const list = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as T[];
            setter(list);
        } catch (error) { console.error(`Error fetching ${collectionName}: `, error); }
    };

    const fetchCourses = () => fetchGeneric<Course>("courses", setCourses);
    const fetchProjects = () => fetchGeneric<Project>("projects", setProjects);
    const fetchStartups = () => fetchGeneric<Startup>("startups", setStartups);
    
    const fetchTickets = async () => {
        if (!db) return;
        try {
            const querySnapshot = await getDocs(collection(db, "tickets"));
            const ticketsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), lastUpdate: doc.data().lastUpdate?.toDate ? doc.data().lastUpdate.toDate().toLocaleDateString() : 'N/A' })) as Ticket[];
            setTickets(ticketsList);
        } catch (error) { console.error("Error fetching tickets: ", error); }
    };
    
    const handleAddCourse = async (e: React.FormEvent) => {
        e.preventDefault(); if (!db) return;
        try {
            await addDoc(collection(db, "courses"), { title: courseTitle, description: courseDescription, videoUrl: courseVideoUrl });
            toast({ title: "Course added successfully." });
            setCourseTitle(''); setCourseDescription(''); setCourseVideoUrl(''); fetchCourses();
        } catch (error) { toast({ title: "Failed to add course.", variant: "destructive" }); }
    };

    const handleAddProject = async (e: React.FormEvent) => {
        e.preventDefault(); if (!db || !projectStartupId) return;
        
        const selectedStartup = startups.find(s => s.id === projectStartupId);
        if (!selectedStartup) {
            toast({ title: "Error", description: "Selected startup not found.", variant: "destructive"});
            return;
        }

        try {
            await addDoc(collection(db, "projects"), { 
                title: projectTitle, 
                startup: selectedStartup.name,
                description: projectDescription, 
                remuneration: remuneration, 
                skills: skills.split(',').map(s => s.trim()), 
                logo: "https://placehold.co/40x40.png", 
                dataAiHint: "abstract geometric" 
            });
            toast({ title: "Project added successfully." });
            setProjectTitle(''); 
            setProjectStartupId(''); 
            setProjectDescription(''); 
            setRemuneration(''); 
            setSkills(''); 
            fetchProjects();
        } catch (error) { 
            toast({ title: "Failed to add project.", variant: "destructive" }); 
        }
    };
    
    const generateTempPassword = () => Math.random().toString(36).slice(-8);

    const handleAddStartup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!auth || !db) return;
    
        const tempPassword = generateTempPassword();
        let userCredential;
    
        try {
            userCredential = await createUserWithEmailAndPassword(auth, newFounderEmail, tempPassword);
            const user = userCredential.user;
    
            const startupRef = doc(collection(db, "startups"));
            const userDocRef = doc(db, "users", user.uid);
    
            const batch = writeBatch(db);
    
            batch.set(startupRef, {
                name: newStartupName,
                founderName: `${newFounderFirstName} ${newFounderLastName}`,
                founderEmail: newFounderEmail,
                founderId: user.uid,
                members: 1, // Start with 1 member
            });
    
            batch.set(userDocRef, {
                uid: user.uid,
                email: newFounderEmail,
                firstName: newFounderFirstName,
                lastName: newFounderLastName,
                role: 'Startup Founder',
                startupId: startupRef.id,
            });

            await batch.commit();
    
            setNewCredentials({ email: newFounderEmail, password: tempPassword });
            toast({ title: "Startup Created", description: `${newStartupName} has been added successfully.` });
    
            setNewStartupName('');
            setNewFounderFirstName('');
            setNewFounderLastName('');
            setNewFounderEmail('');
            setIsAddStartupDialogOpen(false);
            
            fetchStartups();
    
        } catch (error: any) {
            console.error("Error creating startup:", error);
            if (error.code === 'auth/email-already-in-use') {
                toast({ 
                    title: "Creation Failed", 
                    description: "Email is already in use. Please use another email.", 
                    variant: "destructive" 
                });
            } else if (error.code === 'auth/invalid-email') {
                toast({ 
                    title: "Creation Failed", 
                    description: "The email address is not valid.", 
                    variant: "destructive" 
                });
            } else {
                toast({ 
                    title: "Creation Failed", 
                    description: "An unexpected error occurred. Please check the details and try again.", 
                    variant: "destructive" 
                });
            }
        }
    };
    
    const handleEditStartup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !startupToEdit) return;
        try {
            const startupRef = doc(db, "startups", startupToEdit.id);
            await updateDoc(startupRef, {
                name: editedStartupName,
                members: editedStartupMembers,
            });
            toast({ title: "Startup Updated", description: "Information has been saved." });
            fetchStartups();
        } catch (error) {
            toast({ title: "Update Failed", description: "Could not save changes.", variant: "destructive" });
        } finally {
            setIsEditStartupDialogOpen(false);
            setStartupToEdit(null);
        }
    };

    const handleResetPassword = async (startup: Startup) => {
        toast({ title: "This feature is not yet implemented.", description: "Please ask the developer to implement password reset via the Admin SDK.", variant: "destructive" });
        // This is a placeholder. Implementing this safely requires an admin backend (e.g., Cloud Function)
        // to interact with the Firebase Admin SDK, as client-side SDKs cannot directly change other users' passwords.
        // const newPassword = generateTempPassword();
        // setNewCredentials({ email: startup.founderEmail, password: newPassword });
        // console.log(`TODO: Implement secure password reset for user ${startup.founderId} with new password ${newPassword}`);
    };


    const handleDeleteStartup = async () => {
        if (!db || !startupToDelete) return;
        try {
            await deleteDoc(doc(db, "startups", startupToDelete.id));
            toast({ title: "Startup Deleted", description: `${startupToDelete.name} has been removed.` });
            fetchStartups();
        } catch (error) {
            toast({ title: "Error", description: "Could not delete startup.", variant: "destructive" });
        } finally {
            setIsDeleteAlertOpen(false);
            setStartupToDelete(null);
        }
    };
    
    if (isLoading) return <SubpageLayout title="Admin Dashboard"><div className="flex justify-center items-center h-full"><p>Verifying access...</p></div></SubpageLayout>;
    if (!isAuthorized) return null;

    return (
        <SubpageLayout title="Admin Dashboard">
             <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>This action cannot be undone. This will permanently delete the startup {startupToDelete?.name}.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setStartupToDelete(null)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteStartup} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={!!newCredentials} onOpenChange={(open) => !open && setNewCredentials(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Founder Account Credentials</AlertDialogTitle>
                        <AlertDialogDescription>Please securely share these credentials with the founder. They will be prompted to change their password on first login.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="my-4 space-y-2 rounded-lg border bg-muted p-4">
                        <p className="text-sm"><strong>Email:</strong> {newCredentials?.email}</p>
                        <p className="text-sm"><strong>Temporary Password:</strong> <span className="font-mono bg-background p-1 rounded">{newCredentials?.password}</span></p>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setNewCredentials(null)}>Close</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Dialog open={isAddStartupDialogOpen} onOpenChange={setIsAddStartupDialogOpen}>
                 <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add New Startup</DialogTitle>
                        <DialogDescription>
                            Create a new startup and its primary founder account.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAddStartup}>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="startup-name">Startup Name</Label>
                                <Input id="startup-name" value={newStartupName} onChange={(e) => setNewStartupName(e.target.value)} placeholder="e.g., QuantumLeap AI" required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="founder-first-name">Founder's First Name</Label>
                                    <Input id="founder-first-name" value={newFounderFirstName} onChange={(e) => setNewFounderFirstName(e.target.value)} required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="founder-last-name">Founder's Last Name</Label>
                                    <Input id="founder-last-name" value={newFounderLastName} onChange={(e) => setNewFounderLastName(e.target.value)} required />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="founder-email">Founder's Email</Label>
                                <Input id="founder-email" type="email" value={newFounderEmail} onChange={(e) => setNewFounderEmail(e.target.value)} required />
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button type="button" variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button type="submit">Create Startup</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <Dialog open={isEditStartupDialogOpen} onOpenChange={setIsEditStartupDialogOpen}>
                 <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Startup Information</DialogTitle>
                        <DialogDescription>
                            Update the details for {startupToEdit?.name}.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleEditStartup}>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="edit-startup-name">Startup Name</Label>
                                <Input id="edit-startup-name" value={editedStartupName} onChange={(e) => setEditedStartupName(e.target.value)} required />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="edit-startup-members">Number of Members</Label>
                                <Input id="edit-startup-members" type="number" value={editedStartupMembers} onChange={(e) => setEditedStartupMembers(parseInt(e.target.value, 10))} min="1" required />
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button type="button" variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button type="submit">Save Changes</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <Tabs defaultValue="startups" className="w-full">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-4">
                     <TabsTrigger value="startups"><Building2 className="mr-2 h-4 w-4" />Manage Startups</TabsTrigger>
                    <TabsTrigger value="courses"><BookOpen className="mr-2 h-4 w-4" />Manage Courses</TabsTrigger>
                    <TabsTrigger value="projects"><Briefcase className="mr-2 h-4 w-4" />Manage Projects</TabsTrigger>
                    <TabsTrigger value="tickets"><Ticket className="mr-2 h-4 w-4" />View Tickets</TabsTrigger>
                </TabsList>

                <TabsContent value="startups" className="mt-6 space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Startups</CardTitle>
                                <CardDescription>Manage startups in the Infinity Hub ecosystem.</CardDescription>
                            </div>
                            <Button onClick={() => setIsAddStartupDialogOpen(true)}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Startup
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Startup Name</TableHead>
                                        <TableHead>Founder</TableHead>
                                        <TableHead>Founder Email</TableHead>
                                        <TableHead><Users className="inline-block mr-1 h-4 w-4"/>Members</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {startups.map((startup) => (
                                        <TableRow key={startup.id}>
                                            <TableCell className="font-medium">{startup.name}</TableCell>
                                            <TableCell>{startup.founderName}</TableCell>
                                            <TableCell>{startup.founderEmail}</TableCell>
                                            <TableCell>{startup.members}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreVertical className="h-4 w-4" />
                                                            <span className="sr-only">Open menu</span>
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem onSelect={() => { setStartupToEdit(startup); setEditedStartupName(startup.name); setEditedStartupMembers(startup.members); setIsEditStartupDialogOpen(true); }}>
                                                            <Edit className="mr-2 h-4 w-4" /> Edit Information
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => handleResetPassword(startup)}>
                                                            <KeyRound className="mr-2 h-4 w-4" /> Reset Password
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem onSelect={() => { setStartupToDelete(startup); setIsDeleteAlertOpen(true); }} className="text-destructive focus:text-destructive">
                                                            <Trash2 className="mr-2 h-4 w-4" /> Delete Startup
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
                
                <TabsContent value="courses" className="mt-6 space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Upload New Course</CardTitle><CardDescription>Add a new educational course for startups.</CardDescription></CardHeader>
                        <CardContent><form onSubmit={handleAddCourse} className="space-y-4">
                            <div className="space-y-2"><Label htmlFor="course-title">Course Title</Label><Input id="course-title" placeholder="e.g., Advanced Marketing" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} /></div>
                            <div className="space-y-2"><Label htmlFor="course-description">Description</Label><Textarea id="course-description" placeholder="A brief summary of the course content." value={courseDescription} onChange={(e) => setCourseDescription(e.target.value)} /></div>
                            <div className="space-y-2"><Label htmlFor="course-video-url">Video URL (optional)</Label><Input id="course-video-url" placeholder="e.g., https://www.youtube.com/watch?v=..." value={courseVideoUrl} onChange={(e) => setCourseVideoUrl(e.target.value)} /></div>
                            <Button type="submit">Upload Course</Button>
                        </form></CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Existing Courses</CardTitle></CardHeader>
                        <CardContent><Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Description</TableHead><TableHead>Video</TableHead></TableRow></TableHeader><TableBody>{courses.map((course) => (<TableRow key={course.id}><TableCell className="font-medium">{course.title}</TableCell><TableCell>{course.description}</TableCell><TableCell>{course.videoUrl ? <a href={course.videoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View Video</a> : 'N/A'}</TableCell></TableRow>))}</TableBody></Table></CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="projects" className="mt-6 space-y-6">
                     <Card>
                        <CardHeader><CardTitle>Add New Project</CardTitle><CardDescription>Post a new job opportunity for freelancers.</CardDescription></CardHeader>
                        <CardContent><form onSubmit={handleAddProject} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="project-title">Project Title</Label><Input id="project-title" placeholder="e.g., Senior Frontend Engineer" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></div>
                            <div className="space-y-2"><Label htmlFor="startup-name">Startup Name</Label><Select onValueChange={setProjectStartupId} value={projectStartupId}><SelectTrigger id="startup-name"><SelectValue placeholder="Select a startup" /></SelectTrigger><SelectContent>{startups.map(startup => (<SelectItem key={startup.id} value={startup.id}>{startup.name}</SelectItem>))}</SelectContent></Select></div></div>
                            <div className="space-y-2"><Label htmlFor="project-description">Description</Label><Textarea id="project-description" placeholder="Detailed job description..." value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} /></div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="remuneration">Remuneration</Label><Input id="remuneration" placeholder="e.g., Equity + Salary" value={remuneration} onChange={(e) => setRemuneration(e.target.value)} /></div>
                            <div className="space-y-2"><Label htmlFor="skills">Skills Required</Label><Input id="skills" placeholder="Comma-separated, e.g., React, TypeScript" value={skills} onChange={(e) => setSkills(e.target.value)} /></div></div>
                            <Button type="submit">Add Project</Button>
                        </form></CardContent>
                    </Card>
                     <Card>
                        <CardHeader><CardTitle>Existing Projects</CardTitle></CardHeader>
                        <CardContent><Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Startup</TableHead><TableHead>Remuneration</TableHead></TableRow></TableHeader><TableBody>{projects.map((project) => (<TableRow key={project.id}><TableCell className="font-medium">{project.title}</TableCell><TableCell>{project.startup}</TableCell><TableCell>{project.remuneration}</TableCell></TableRow>))}</TableBody></Table></CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="tickets" className="mt-6">
                    <Card>
                        <CardHeader><CardTitle>Support Tickets</CardTitle><CardDescription>Incoming tickets from corporate clients.</CardDescription></CardHeader>
                        <CardContent><Table><TableHeader><TableRow><TableHead>Ticket ID</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead>Last Update</TableHead></TableRow></TableHeader>
                            <TableBody>{tickets.map(ticket => (<TableRow key={ticket.id}><TableCell className="font-mono">{ticket.id.substring(0,6)}...</TableCell><TableCell className="font-medium">{ticket.subject}</TableCell>
                                <TableCell><Badge variant={ticket.status === 'Completed' ? 'default' : ticket.status === 'In Progress' ? 'secondary' : 'destructive'} className={ticket.status === 'Completed' ? 'bg-green-500/20 text-green-700' : ticket.status === 'In Progress' ? 'bg-blue-500/20 text-blue-700' : 'bg-yellow-500/20 text-yellow-700'}>{ticket.status}</Badge></TableCell>
                                <TableCell>{ticket.lastUpdate}</TableCell></TableRow>))}
                            </TableBody>
                        </Table></CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </SubpageLayout>
    );
}

    