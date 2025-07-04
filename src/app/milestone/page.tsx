
"use client";

import { useState, useEffect } from 'react';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Target, CheckCircle2 } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";


const deadlines = [
    { task: "User Authentication Flow", due: "3 days", status: "In Progress" },
    { task: "Payment Gateway Integration", due: "1 week", status: "Not Started" },
    { task: "Mobile App Beta Release", due: "3 weeks", status: "Not Started" },
];

interface Course {
    id: string;
    title: string;
    description: string;
    videoUrl?: string;
}

const getEmbedUrl = (url: string) => {
    let embedUrl = '';
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes('youtube.com')) {
            const videoId = urlObj.searchParams.get('v');
            if (videoId) embedUrl = `https://www.youtube.com/embed/${videoId}`;
        } else if (urlObj.hostname.includes('youtu.be')) {
            const videoId = urlObj.pathname.slice(1);
            if (videoId) embedUrl = `https://www.youtube.com/embed/${videoId}`;
        } else if (urlObj.hostname.includes('vimeo.com')) {
            const videoId = urlObj.pathname.split('/').pop();
            if (videoId) embedUrl = `https://player.vimeo.com/video/${videoId}`;
        }
    } catch (error) {
        console.error("Invalid URL for embedding", error);
        return null;
    }
    return embedUrl;
};

export default function MilestonePage() {
    const [courses, setCourses] = useState<Course[]>([]);

    useEffect(() => {
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
        fetchCourses();
    }, []);

    return (
        <SubpageLayout title="Milestone Dashboard">
            <div className="grid gap-8">
                <Card>
                    <CardHeader>
                        <CardTitle>Project Advancement</CardTitle>
                        <CardDescription>Your project is currently 75% complete.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Progress value={75} className="w-full" />
                    </CardContent>
                </Card>

                <div className="grid gap-8 md:grid-cols-3">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Tasks Completed</CardTitle>
                            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">42</div>
                            <p className="text-xs text-muted-foreground">/ 56 total tasks</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Active Sprints</CardTitle>
                            <Target className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">2</div>
                            <p className="text-xs text-muted-foreground">Sprint #4 and #5</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Next Milestone</CardTitle>
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                         <CardContent>
                            <div className="text-2xl font-bold">Public Beta</div>
                            <p className="text-xs text-muted-foreground">Scheduled for next month</p>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Upcoming Deadlines</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Task</TableHead>
                                    <TableHead>Due In</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {deadlines.map(d => (
                                    <TableRow key={d.task}>
                                        <TableCell className="font-medium">{d.task}</TableCell>
                                        <TableCell>{d.due}</TableCell>
                                        <TableCell>
                                            <Badge variant={d.status === 'In Progress' ? 'default' : 'secondary'} className="bg-accent text-accent-foreground">{d.status}</Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <div>
                    <h2 className="text-2xl font-headline font-semibold tracking-tight mb-4">Startup Courses</h2>
                    <div className="grid gap-6 md:grid-cols-3">
                        {courses.map(course => {
                            const embedUrl = course.videoUrl ? getEmbedUrl(course.videoUrl) : null;
                            return (
                                 <Card key={course.id}>
                                    {embedUrl && (
                                        <div className="aspect-video w-full overflow-hidden rounded-t-lg">
                                            <iframe
                                                src={embedUrl}
                                                title={course.title}
                                                frameBorder="0"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                                className="w-full h-full"
                                            ></iframe>
                                        </div>
                                    )}
                                    <CardHeader className={!embedUrl ? "" : "pt-6"}>
                                        <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary"/>{course.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">{course.description}</p>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>
            </div>
        </SubpageLayout>
    )
}
