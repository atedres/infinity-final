
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
import { BookOpen, Briefcase, Ticket, Building2, UserCog, Trash2 } from "lucide-react";
import { collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, where, query } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
    description: string;
    website: string;
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
    const [users, setUsers] = useState<User[]>([]);
    const [startupUsers, setStartupUsers] = useState<StartupUser[]>([]);
    const [startupToDelete, setStartupToDelete] = useState<Startup | null>(null);
    const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);

    // Form states
    const [courseTitle, setCourseTitle] = useState('');
    const [courseDescription, setCourseDescription] = useState('');
    const [courseVideoUrl, setCourseVideoUrl] = useState('');
    const [projectTitle, setProjectTitle] = useState('');
    const [projectStartupId, setProjectStartupId] = useState('');
    const [projectDescription, setProjectDescription] = useState('');
    const [remuneration, setRemuneration] = useState('');
    const [skills, setSkills] = useState('');
    const [newStartupName, setNewStartupName] = useState('');
    const [newStartupDescription, setNewStartupDescription] = useState('');
    const [newStartupWebsite, setNewStartupWebsite] = useState('');
    const [selectedUser, setSelectedUser] = useState('');
    const [selectedStartup, setSelectedStartup] = useState('');

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
        fetchUsers();
        fetchStartupUsers();
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
    const fetchUsers = () => fetchGeneric<User>("users", setUsers);
    
    const fetchTickets = async () => {
        if (!db) return;
        try {
            const querySnapshot = await getDocs(collection(db, "tickets"));
            const ticketsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), lastUpdate: doc.data().lastUpdate?.toDate ? doc.data().lastUpdate.toDate().toLocaleDateString() : 'N/A' })) as Ticket[];
            setTickets(ticketsList);
        } catch (error) { console.error("Error fetching tickets: ", error); }
    };

    const fetchStartupUsers = async () => {
        if (!db) return;
        try {
            const q = query(collection(db, "users"), where("startupId", "!=", ""));
            const querySnapshot = await getDocs(q);
            const usersList = await Promise.all(querySnapshot.docs.map(async (userDoc) => {
                const userData = userDoc.data();
                let startupName = 'Unknown';
                if (userData.startupId) {
                    const startupDoc = await getDoc(doc(db, "startups", userData.startupId));
                    if (startupDoc.exists()) {
                        startupName = startupDoc.data().name;
                    }
                }
                return { ...userData, id: userDoc.id, startupName } as StartupUser;
            }));
            setStartupUsers(usersList);
        } catch (error) { console.error("Error fetching startup users: ", error); }
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

    const handleAddStartup = async (e: React.FormEvent) => {
        e.preventDefault(); if (!db) return;
        try {
            await addDoc(collection(db, "startups"), { name: newStartupName, description: newStartupDescription, website: newStartupWebsite });
            toast({ title: "Startup added successfully." });
            setNewStartupName(''); setNewStartupDescription(''); setNewStartupWebsite(''); fetchStartups();
        } catch (error) { toast({ title: "Failed to add startup.", variant: "destructive" }); }
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
    
    const handleAssignUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !selectedUser || !selectedStartup) {
            toast({ title: "Error", description: "Please select a user and a startup.", variant: "destructive" });
            return;
        }
        try {
            const userDocRef = doc(db, "users", selectedUser);
            await updateDoc(userDocRef, { startupId: selectedStartup });
            toast({ title: "User Assigned", description: "User has been granted access to the startup hub." });
            setSelectedUser('');
            setSelectedStartup('');
            fetchStartupUsers();
        } catch (error) {
            toast({ title: "Assignment Failed", description: "Could not assign user to startup.", variant: "destructive" });
        }
    };

    const handleRevokeAccess = async (userId: string) => {
        if (!db) return;
        try {
            const userDocRef = doc(db, "users", userId);
            await updateDoc(userDocRef, { startupId: "" });
            toast({ title: "Access Revoked", description: "User access has been revoked." });
            fetchStartupUsers();
        } catch (error) {
            toast({ title: "Error", description: "Could not revoke user access.", variant: "destructive" });
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
            <Tabs defaultValue="startups" className="w-full">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-5">
                     <TabsTrigger value="startups"><Building2 className="mr-2 h-4 w-4" />Manage Startups</TabsTrigger>
                     <TabsTrigger value="startup-users"><UserCog className="mr-2 h-4 w-4" />Startup Users</TabsTrigger>
                    <TabsTrigger value="courses"><BookOpen className="mr-2 h-4 w-4" />Manage Courses</TabsTrigger>
                    <TabsTrigger value="projects"><Briefcase className="mr-2 h-4 w-4" />Manage Projects</TabsTrigger>
                    <TabsTrigger value="tickets"><Ticket className="mr-2 h-4 w-4" />View Tickets</TabsTrigger>
                </TabsList>

                <TabsContent value="startups" className="mt-6 space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Add New Startup</CardTitle><CardDescription>Add a new startup to the Infinity Hub ecosystem.</CardDescription></CardHeader>
                        <CardContent>
                            <form onSubmit={handleAddStartup} className="space-y-4">
                                <div className="space-y-2"><Label htmlFor="startup-new-name">Startup Name</Label><Input id="startup-new-name" placeholder="e.g., QuantumLeap" value={newStartupName} onChange={(e) => setNewStartupName(e.target.value)} /></div>
                                <div className="space-y-2"><Label htmlFor="startup-new-desc">Description</Label><Textarea id="startup-new-desc" placeholder="What does this startup do?" value={newStartupDescription} onChange={(e) => setNewStartupDescription(e.target.value)} /></div>
                                 <div className="space-y-2"><Label htmlFor="startup-new-website">Website</Label><Input id="startup-new-website" placeholder="https://quantumleap.ai" value={newStartupWebsite} onChange={(e) => setNewStartupWebsite(e.target.value)} /></div>
                                <Button type="submit">Add Startup</Button>
                            </form>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Existing Startups</CardTitle></CardHeader>
                        <CardContent>
                            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Website</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {startups.map((startup) => (
                                        <TableRow key={startup.id}>
                                            <TableCell className="font-medium">{startup.name}</TableCell>
                                            <TableCell>{startup.description}</TableCell>
                                            <TableCell><a href={startup.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{startup.website}</a></TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" onClick={() => { setStartupToDelete(startup); setIsDeleteAlertOpen(true); }}>
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
                
                <TabsContent value="startup-users" className="mt-6 space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Assign User to Startup</CardTitle><CardDescription>Grant a registered user access to a specific startup's hub.</CardDescription></CardHeader>
                        <CardContent>
                            <form onSubmit={handleAssignUser} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="space-y-2"><Label htmlFor="user-select">User</Label>
                                        <Select onValueChange={setSelectedUser} value={selectedUser}><SelectTrigger id="user-select"><SelectValue placeholder="Select a user" /></SelectTrigger>
                                            <SelectContent>{users.filter(u => !startupUsers.some(su => su.uid === u.uid)).map(user => (<SelectItem key={user.uid} value={user.uid}>{user.firstName} {user.lastName} ({user.email})</SelectItem>))}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2"><Label htmlFor="startup-select">Startup</Label>
                                        <Select onValueChange={setSelectedStartup} value={selectedStartup}><SelectTrigger id="startup-select"><SelectValue placeholder="Select a startup" /></SelectTrigger>
                                            <SelectContent>{startups.map(startup => (<SelectItem key={startup.id} value={startup.id}>{startup.name}</SelectItem>))}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-end"><Button type="submit" className="w-full">Assign User</Button></div>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Current Startup Users</CardTitle></CardHeader>
                        <CardContent>
                             <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Assigned Startup</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {startupUsers.map((user) => (
                                        <TableRow key={user.uid}>
                                            <TableCell className="font-medium">{user.firstName} {user.lastName}</TableCell>
                                            <TableCell>{user.email}</TableCell>
                                            <TableCell>{user.startupName}</TableCell>
                                            <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => handleRevokeAccess(user.uid)}>Revoke Access</Button></TableCell>
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
