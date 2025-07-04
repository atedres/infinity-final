
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
import { BookOpen, Briefcase, Ticket, Building2 } from "lucide-react";
import { collection, addDoc, getDocs, doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


// Types
interface Course {
    id: string;
    title: string;
    description: string;
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

export default function AdminDashboardPage() {
    const { toast } = useToast();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [courses, setCourses] = useState<Course[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [startups, setStartups] = useState<Startup[]>([]);

    // Form states for new course
    const [courseTitle, setCourseTitle] = useState('');
    const [courseDescription, setCourseDescription] = useState('');

    // Form states for new project
    const [projectTitle, setProjectTitle] = useState('');
    const [startupName, setStartupName] = useState('');
    const [projectDescription, setProjectDescription] = useState('');
    const [remuneration, setRemuneration] = useState('');
    const [skills, setSkills] = useState('');

    // Form states for new startup
    const [newStartupName, setNewStartupName] = useState('');
    const [newStartupDescription, setNewStartupDescription] = useState('');
    const [newStartupWebsite, setNewStartupWebsite] = useState('');

     useEffect(() => {
        if (!auth || !db) {
            router.push('/');
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists() && userDocSnap.data().is_admin === true) {
                    setIsAuthorized(true);
                    fetchCourses();
                    fetchProjects();
                    fetchTickets();
                    fetchStartups();
                } else {
                    toast({ title: "Access Denied", description: "You do not have permission to view this page.", variant: "destructive" });
                    router.push('/');
                }
            } else {
                toast({ title: "Authentication Required", description: "Please log in to access the admin dashboard.", variant: "destructive" });
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

    const fetchProjects = async () => {
        if (!db) return;
        try {
            const querySnapshot = await getDocs(collection(db, "projects"));
            const projectsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Project[];
            setProjects(projectsList);
        } catch (error) {
            console.error("Error fetching projects: ", error);
        }
    };

    const fetchTickets = async () => {
        if (!db) return;
        try {
            const querySnapshot = await getDocs(collection(db, "tickets"));
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

    const fetchStartups = async () => {
        if (!db) return;
        try {
            const querySnapshot = await getDocs(collection(db, "startups"));
            const startupsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Startup[];
            setStartups(startupsList);
        } catch (error) {
            console.error("Error fetching startups: ", error);
        }
    };

    const handleAddCourse = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db) return;
        if (!courseTitle || !courseDescription) {
            toast({ title: "Error", description: "Please fill all fields.", variant: "destructive" });
            return;
        }
        try {
            await addDoc(collection(db, "courses"), {
                title: courseTitle,
                description: courseDescription,
            });
            toast({ title: "Success", description: "Course added successfully." });
            setCourseTitle('');
            setCourseDescription('');
            fetchCourses(); // Refresh list
        } catch (error) {
            console.error("Error adding course: ", error);
            toast({ title: "Error", description: "Failed to add course.", variant: "destructive" });
        }
    };

    const handleAddProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db) return;
        if (!projectTitle || !startupName || !projectDescription || !remuneration || !skills) {
             toast({ title: "Error", description: "Please fill all fields.", variant: "destructive" });
            return;
        }
        try {
            await addDoc(collection(db, "projects"), {
                title: projectTitle,
                startup: startupName,
                description: projectDescription,
                remuneration: remuneration,
                skills: skills.split(',').map(s => s.trim()),
                logo: "https://placehold.co/40x40.png",
                dataAiHint: "abstract geometric"
            });
            toast({ title: "Success", description: "Project added successfully." });
            setProjectTitle('');
            setStartupName('');
            setProjectDescription('');
            setRemuneration('');
            setSkills('');
            fetchProjects(); // Refresh list
        } catch (error) {
            console.error("Error adding project: ", error);
            toast({ title: "Error", description: "Failed to add project.", variant: "destructive" });
        }
    };

    const handleAddStartup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db) return;
        if (!newStartupName || !newStartupDescription) {
            toast({ title: "Error", description: "Please fill at least name and description.", variant: "destructive" });
            return;
        }
        try {
            await addDoc(collection(db, "startups"), {
                name: newStartupName,
                description: newStartupDescription,
                website: newStartupWebsite,
            });
            toast({ title: "Success", description: "Startup added successfully." });
            setNewStartupName('');
            setNewStartupDescription('');
            setNewStartupWebsite('');
            fetchStartups(); // Refresh list
        } catch (error) {
            console.error("Error adding startup: ", error);
            toast({ title: "Error", description: "Failed to add startup.", variant: "destructive" });
        }
    };

    if (isLoading) {
        return <SubpageLayout title="Admin Dashboard"><div className="flex justify-center items-center h-full"><p>Verifying access...</p></div></SubpageLayout>;
    }

    if (!isAuthorized) {
        return null;
    }


    return (
        <SubpageLayout title="Admin Dashboard">
            <Tabs defaultValue="courses" className="w-full">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-4">
                     <TabsTrigger value="startups">
                        <Building2 className="mr-2 h-4 w-4" />
                        Manage Startups
                    </TabsTrigger>
                    <TabsTrigger value="courses">
                        <BookOpen className="mr-2 h-4 w-4" />
                        Manage Courses
                    </TabsTrigger>
                    <TabsTrigger value="projects">
                        <Briefcase className="mr-2 h-4 w-4" />
                        Manage Projects
                    </TabsTrigger>
                    <TabsTrigger value="tickets">
                        <Ticket className="mr-2 h-4 w-4" />
                        View Tickets
                    </TabsTrigger>
                </TabsList>

                {/* Manage Startups Tab */}
                <TabsContent value="startups" className="mt-6 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Add New Startup</CardTitle>
                            <CardDescription>Add a new startup to the Infinity Hub ecosystem.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleAddStartup} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="startup-new-name">Startup Name</Label>
                                    <Input id="startup-new-name" placeholder="e.g., QuantumLeap" value={newStartupName} onChange={(e) => setNewStartupName(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="startup-new-desc">Description</Label>
                                    <Textarea id="startup-new-desc" placeholder="What does this startup do?" value={newStartupDescription} onChange={(e) => setNewStartupDescription(e.target.value)} />
                                </div>
                                 <div className="space-y-2">
                                    <Label htmlFor="startup-new-website">Website</Label>
                                    <Input id="startup-new-website" placeholder="https://quantumleap.ai" value={newStartupWebsite} onChange={(e) => setNewStartupWebsite(e.target.value)} />
                                </div>
                                <Button type="submit">Add Startup</Button>
                            </form>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Existing Startups</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead>Website</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {startups.map((startup) => (
                                        <TableRow key={startup.id}>
                                            <TableCell className="font-medium">{startup.name}</TableCell>
                                            <TableCell>{startup.description}</TableCell>
                                             <TableCell><a href={startup.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{startup.website}</a></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Manage Courses Tab */}
                <TabsContent value="courses" className="mt-6 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Upload New Course</CardTitle>
                            <CardDescription>Add a new educational course for startups.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleAddCourse} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="course-title">Course Title</Label>
                                    <Input id="course-title" placeholder="e.g., Advanced Marketing" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="course-description">Description</Label>
                                    <Textarea id="course-description" placeholder="A brief summary of the course content." value={courseDescription} onChange={(e) => setCourseDescription(e.target.value)} />
                                </div>
                                <Button type="submit">Upload Course</Button>
                            </form>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Existing Courses</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Title</TableHead>
                                        <TableHead>Description</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {courses.map((course) => (
                                        <TableRow key={course.id}>
                                            <TableCell className="font-medium">{course.title}</TableCell>
                                            <TableCell>{course.description}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Manage Projects Tab */}
                <TabsContent value="projects" className="mt-6 space-y-6">
                     <Card>
                        <CardHeader>
                            <CardTitle>Add New Project</CardTitle>
                            <CardDescription>Post a new job opportunity for freelancers.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleAddProject} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="project-title">Project Title</Label>
                                        <Input id="project-title" placeholder="e.g., Senior Frontend Engineer" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="startup-name">Startup Name</Label>
                                        <Select onValueChange={setStartupName} value={startupName}>
                                            <SelectTrigger id="startup-name">
                                                <SelectValue placeholder="Select a startup" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {startups.map(startup => (
                                                    <SelectItem key={startup.id} value={startup.name}>
                                                        {startup.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                 <div className="space-y-2">
                                    <Label htmlFor="project-description">Description</Label>
                                    <Textarea id="project-description" placeholder="Detailed job description..." value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} />
                                </div>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                   <div className="space-y-2">
                                        <Label htmlFor="remuneration">Remuneration</Label>
                                        <Input id="remuneration" placeholder="e.g., Equity + Salary" value={remuneration} onChange={(e) => setRemuneration(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="skills">Skills Required</Label>
                                        <Input id="skills" placeholder="Comma-separated, e.g., React, TypeScript" value={skills} onChange={(e) => setSkills(e.target.value)} />
                                    </div>
                                </div>
                                <Button type="submit">Add Project</Button>
                            </form>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader>
                            <CardTitle>Existing Projects</CardTitle>
                        </CardHeader>
                        <CardContent>
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Title</TableHead>
                                        <TableHead>Startup</TableHead>
                                        <TableHead>Remuneration</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {projects.map((project) => (
                                        <TableRow key={project.id}>
                                            <TableCell className="font-medium">{project.title}</TableCell>
                                            <TableCell>{project.startup}</TableCell>
                                            <TableCell>{project.remuneration}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* View Tickets Tab */}
                <TabsContent value="tickets" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Support Tickets</CardTitle>
                            <CardDescription>Incoming tickets from corporate clients.</CardDescription>
                        </CardHeader>
                        <CardContent>
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
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </SubpageLayout>
    );
}
