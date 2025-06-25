
"use client";

import { useState, useEffect } from 'react';
import {
  Rocket,
  Briefcase,
  Mic,
  Building,
  Infinity as InfinityIcon,
  Quote,
  LogOut,
  User as UserIcon,
  Bell,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, User, signInWithPopup, updateProfile } from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";


const features = [
  {
    icon: <Rocket className="h-8 w-8 text-primary" />,
    title: 'Milestone',
    description: 'A dedicated space for our invested startups to monitor project development and access educational courses.',
    href: '/milestone',
    cta: 'View Dashboard',
  },
  {
    icon: <Briefcase className="h-8 w-8 text-primary" />,
    title: 'Join Project',
    description: 'A platform for freelancers and tech graduates to find and join exciting startup projects we are building.',
    href: '/join-project',
    cta: 'Browse Projects',
  },
  {
    icon: <Mic className="h-8 w-8 text-primary" />,
    title: 'Sound Sphere',
    description: 'A social hub for developers, designers, and founders to connect, share, and collaborate.',
    href: '/sound-sphere',
    cta: 'Enter the Sphere',
  },
  {
    icon: <Building className="h-8 w-8 text-primary" />,
    title: 'Corp Hub',
    description: 'An exclusive portal for corporate clients to track projects, manage support, and view their team.',
    href: '/corp-hub',
    cta: 'Access Hub',
  },
];

const testimonials = [
    {
        quote: "Infinity Hub transformed our project management. The seamless integration and dedicated support are second to none.",
        author: "Jane Doe",
        role: "CEO, InnovateAI",
        avatar: "https://placehold.co/48x48.png",
        dataAiHint: "person smiling"
    },
    {
        quote: "As a freelancer, finding quality projects was tough. Infinity Hub's 'Join Project' feature connected me with my dream team.",
        author: "John Smith",
        role: "Lead Developer, Healthify",
        avatar: "https://placehold.co/48x48.png",
        dataAiHint: "professional portrait"
    },
    {
        quote: "The educational resources in the Milestone dashboard have been invaluable for our startup's growth. Highly recommended!",
        author: "Emily White",
        role: "Founder, ConnectSphere",
        avatar: "https://placehold.co/48x48.png",
        dataAiHint: "person thinking"
    }
];

const stats = [
    { value: "50+", label: "Projects Launched" },
    { value: "100+", label: "Startups Accelerated" },
    { value: "98%", label: "Client Satisfaction" },
    { value: "500+", label: "Community Members" },
]

// Mock data for notifications UI
const mockNotifications = [
    { id: 1, text: "John Smith started following you.", href: "#", time: "5 minutes ago" },
    { id: 2, text: "Your post 'My first day with Next.js' received a new comment.", href: "#", time: "1 hour ago" },
    { id: 3, text: "Jane Doe joined the 'Tech Startup Mixer' audio room.", href: "#", time: "3 hours ago" },
];


export default function Home() {
    const { toast } = useToast();
    const [user, setUser] = useState<User | null>(null);
    const [authAction, setAuthAction] = useState<'login' | 'signup' | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [role, setRole] = useState('');
    const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
    const [notifications, setNotifications] = useState(mockNotifications);

    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });
        return () => unsubscribe();
    }, []);

    const handleAuthDialogOpen = (action: 'login' | 'signup') => {
        setAuthAction(action);
        setIsAuthDialogOpen(true);
        setEmail('');
        setPassword('');
        setFirstName('');
        setLastName('');
        setRole('');
    }

    const handleAuthAction = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!auth || !db) return;
        if (!email || !password) {
            toast({ title: "Error", description: "Email and password are required.", variant: "destructive"});
            return;
        }

        try {
            if (authAction === 'signup') {
                 if (!firstName || !lastName || !role) {
                    toast({ title: "Error", description: "Please fill out all fields.", variant: "destructive"});
                    return;
                }
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                await updateProfile(user, { displayName: `${firstName} ${lastName}` });
                
                await setDoc(doc(db, "users", user.uid), {
                    uid: user.uid,
                    email: user.email,
                    firstName,
                    lastName,
                    role,
                    createdAt: serverTimestamp(),
                    is_admin: false,
                    photoURL: '',
                    bio: '',
                });
                toast({ title: "Success", description: "Account created successfully!"});

            } else { // Login
                await signInWithEmailAndPassword(auth, email, password);
                toast({ title: "Success", description: "Logged in successfully!"});
            }
            setIsAuthDialogOpen(false);
        } catch (error: any) {
            console.error("Firebase Auth Error:", error.code, error.message);
            let description = "An unexpected error occurred. Please try again.";
            switch (error.code) {
                case 'auth/weak-password':
                    description = 'The password is too weak. Please use at least 6 characters.';
                    break;
                case 'auth/email-already-in-use':
                    description = 'This email address is already in use by another account.';
                    break;
                case 'auth/invalid-email':
                    description = 'Please enter a valid email address.';
                    break;
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    description = 'Invalid email or password. Please try again.';
                    break;
                case 'auth/unauthorized-domain':
                    description = "This app's domain is not authorized. Please add 'localhost' (or your deployed domain) to the authorized domains in your Firebase project's authentication settings.";
                    break;
                default:
                    description = error.message;
            }
            toast({ title: "Authentication Error", description, variant: "destructive"});
        }
    };

    const handleGoogleSignIn = async () => {
        if (!auth || !db || !googleProvider) return;
        try {
            const result = await signInWithPopup(auth, googleProvider);
            const user = result.user;

            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                // Create a new user document if it's their first time
                await setDoc(userDocRef, {
                    uid: user.uid,
                    email: user.email,
                    firstName: user.displayName?.split(' ')[0] || '',
                    lastName: user.displayName?.split(' ').slice(1).join(' ') || '',
                    role: 'Other', // Default role
                    createdAt: serverTimestamp(),
                    is_admin: false,
                    photoURL: user.photoURL || '',
                    bio: '',
                });
            }
            toast({ title: "Success", description: "Logged in with Google successfully!"});
            setIsAuthDialogOpen(false);
        } catch (error: any) {
            console.error("Google Sign-In Error:", error.code, error.message);
            let description = "An unexpected error occurred. Please try again.";
            switch(error.code) {
                case 'auth/popup-closed-by-user':
                    description = 'The sign-in window was closed. Please try again.';
                    break;
                case 'auth/account-exists-with-different-credential':
                    description = 'An account already exists with this email. Please sign in using the original method.';
                    break;
                case 'auth/unauthorized-domain':
                    description = "This app's domain is not authorized. Please add 'localhost' (or your deployed domain) to the authorized domains in your Firebase project's authentication settings.";
                    break;
                default:
                    description = error.message;
            }
            toast({ title: "Authentication Error", description, variant: "destructive"});
        }
    };


    const handleSignOut = async () => {
        if (!auth) return;
        try {
            await signOut(auth);
            toast({ title: "Signed Out", description: "You have been successfully signed out." });
        } catch (error: any) {
             toast({ title: "Error", description: error.message, variant: "destructive"});
        }
    };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 max-w-screen-2xl items-center px-4 md:px-6">
            <Link href="/" className="mr-6 flex items-center space-x-2">
                <InfinityIcon className="h-6 w-6 text-primary" />
                <span className="font-bold sm:inline-block">
                    Infinity Software
                </span>
            </Link>
            <div className="flex flex-1 items-center justify-end space-x-2 md:space-x-4">
                 <nav className="flex items-center gap-1 md:gap-2">
                    <Button variant="ghost" asChild className="px-2">
                        <Link href="/sound-sphere" className="flex items-center gap-2">
                            <Mic className="h-5 w-5" />
                            <span className="hidden sm:inline">Sound Sphere</span>
                        </Link>
                    </Button>
                     <Button variant="ghost" asChild className="px-2">
                        <Link href="/join-project" className="flex items-center gap-2">
                            <Briefcase className="h-5 w-5" />
                            <span className="hidden sm:inline">Join Project</span>
                        </Link>
                    </Button>
                </nav>

                {user ? (
                <div className="flex items-center space-x-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full">
                                <Bell className="h-5 w-5" />
                                {notifications.length > 0 && (
                                    <span className="absolute top-0 right-0 flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                    </span>
                                )}
                                <span className="sr-only">View notifications</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80">
                            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {notifications.length > 0 ? (
                                notifications.map(notification => (
                                    <DropdownMenuItem key={notification.id} asChild className="cursor-pointer">
                                        <Link href={notification.href} className="flex flex-col items-start gap-1 w-full">
                                            <p className="text-sm leading-tight whitespace-normal">{notification.text}</p>
                                            <p className="text-xs text-muted-foreground">{notification.time}</p>
                                        </Link>
                                    </DropdownMenuItem>
                                ))
                            ) : (
                                <DropdownMenuItem disabled>
                                    <p className="text-sm text-center w-full">No new notifications</p>
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                                <Avatar className="h-9 w-9">
                                    <AvatarImage src={user.photoURL || ''} alt={user.displayName || 'User'} />
                                    <AvatarFallback>{user.displayName?.split(' ').map(n => n[0]).join('').substring(0, 2) || user.email?.charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-56" align="end" forceMount>
                            <DropdownMenuLabel className="font-normal">
                                <div className="flex flex-col space-y-1">
                                    <p className="text-sm font-medium leading-none">{user.displayName}</p>
                                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                                </div>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                                <Link href={`/profile/${user.uid}`}>
                                    <UserIcon className="mr-2 h-4 w-4" />
                                    <span>Profile</span>
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleSignOut}>
                                <LogOut className="mr-2 h-4 w-4" />
                                <span>Log out</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                ) : (
                    <div className="flex items-center space-x-2">
                        <Button variant="ghost" onClick={() => handleAuthDialogOpen('login')}>
                            Login
                        </Button>
                        <Button onClick={() => handleAuthDialogOpen('signup')}>
                            Sign Up
                        </Button>
                    </div>
                )}
            </div>
        </div>
      </header>
      <main className="flex-1">
        {/* Hero / About Us Section */}
        <section className="w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6">
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 xl:gap-16">
                 <div className="flex flex-col justify-center space-y-4 text-center lg:text-left">
                    <div className="space-y-2">
                        <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl font-headline">
                        Accelerating Innovation, Together
                        </h1>
                        <p className="max-w-[600px] text-muted-foreground md:text-xl">
                        Infinity Hub is the central platform by Infinity Software, designed to bridge the gap between visionary startups, talented freelancers, and forward-thinking corporations. We provide the tools, resources, and connections to turn great ideas into reality.
                        </p>
                    </div>
                </div>
                <Image
                    src="https://placehold.co/600x400.png"
                    alt="Team working in an office"
                    width={600}
                    height={400}
                    className="mx-auto aspect-[16/10] overflow-hidden rounded-xl object-cover object-center sm:w-full"
                    data-ai-hint="office team"
                />
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="w-full py-12 md:py-24 bg-muted">
            <div className="container px-4 md:px-6">
                <div className="grid grid-cols-2 gap-6 text-center md:grid-cols-4">
                    {stats.map(stat => (
                        <div key={stat.label} className="flex flex-col items-center justify-center space-y-2">
                            <p className="text-4xl font-bold tracking-tighter sm:text-5xl text-primary">{stat.value}</p>
                            <p className="text-sm font-medium tracking-wide text-muted-foreground">{stat.label}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>


        {/* Features Section */}
        <section id="features" className="w-full py-12 md:py-24 lg:py-32">
            <div className="container space-y-12 px-4 md:px-6">
                 <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <div className="space-y-2">
                        <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl font-headline">Our Ecosystem</h2>
                        <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                        Explore the different portals of Infinity Hub, each tailored to a unique part of our community.
                        </p>
                    </div>
                </div>
                <div className="mx-auto grid items-start gap-8 sm:max-w-4xl sm:grid-cols-2 md:gap-12 lg:max-w-5xl lg:grid-cols-4">
                    {features.map((feature) => (
                    <Card key={feature.title} className="flex flex-col overflow-hidden transition-transform duration-300 ease-in-out hover:-translate-y-2 hover:shadow-xl">
                        <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-2">
                        {feature.icon}
                        <CardTitle className="font-headline text-xl">{feature.title}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1">
                        <CardDescription>{feature.description}</CardDescription>
                        </CardContent>
                        <CardFooter>
                        <Button asChild className="w-full" variant="outline">
                            <Link href={feature.href}>{feature.cta}</Link>
                        </Button>
                        </CardFooter>
                    </Card>
                    ))}
                </div>
            </div>
        </section>

        {/* Testimonials Section */}
        <section className="w-full py-12 md:py-24 lg:py-32 bg-muted">
            <div className="container px-4 md:px-6">
                <div className="flex flex-col items-center justify-center space-y-4 text-center mb-12">
                    <div className="space-y-2">
                        <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl font-headline">What Our Partners Say</h2>
                        <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed">
                            Hear from the leaders and creators who have grown with Infinity Hub.
                        </p>
                    </div>
                </div>
                <div className="grid gap-6 md:grid-cols-3">
                    {testimonials.map(testimonial => (
                        <Card key={testimonial.author}>
                            <CardContent className="p-6 space-y-4">
                                <Quote className="h-6 w-6 text-primary" />
                                <p className="text-muted-foreground">"{testimonial.quote}"</p>
                                <div className="flex items-center gap-4 pt-4">
                                    <Avatar>
                                        <AvatarImage src={testimonial.avatar} data-ai-hint={testimonial.dataAiHint} />
                                        <AvatarFallback>{testimonial.author.split(' ').map(n=>n[0]).join('')}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="font-semibold">{testimonial.author}</p>
                                        <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </section>

        <Dialog open={isAuthDialogOpen} onOpenChange={setIsAuthDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{authAction === 'login' ? 'Login' : 'Sign Up'}</DialogTitle>
                    <DialogDescription>
                        {authAction === 'login' ? 'Enter your credentials to access your account.' : 'Create an account to get started.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                     <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
                        <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512"><path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 126 21.2 172.9 56.6l-80.1 62.4C309.1 93.3 280.3 80 248 80c-73.2 0-132.3 59.1-132.3 132S174.8 388 248 388c78.2 0 118.9-52.2 123.4-78.2h-123.4v-64.8h232.2c1.7 12.2 2.6 25.3 2.6 39.8z"></path></svg>
                        {authAction === 'login' ? 'Login with Google' : 'Sign Up with Google'}
                    </Button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                        </div>
                    </div>

                    <form onSubmit={handleAuthAction} className="space-y-4">
                        {authAction === 'signup' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="first-name">First Name</Label>
                                    <Input id="first-name" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="last-name">Last Name</Label>
                                    <Input id="last-name" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                                </div>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                        {authAction === 'signup' && (
                            <div className="space-y-2">
                                <Label htmlFor="role">I am a...</Label>
                                <Select onValueChange={setRole} value={role}>
                                    <SelectTrigger id="role">
                                        <SelectValue placeholder="Select your role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Startup Founder">Startup Founder</SelectItem>
                                        <SelectItem value="Student">Student</SelectItem>
                                        <SelectItem value="Developer">Developer</SelectItem>
                                        <SelectItem value="Designer">Designer</SelectItem>
                                        <SelectItem value="Other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <DialogFooter>
                            <Button type="submit" className="w-full">{authAction === 'login' ? 'Login' : 'Create Account'}</Button>
                        </DialogFooter>
                    </form>
                </div>
            </DialogContent>
        </Dialog>

      </main>
      <footer className="border-t">
        <div className="container flex flex-col items-center justify-between gap-4 py-4 text-center md:h-20 md:flex-row md:py-0 px-4 md:px-6">
           <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} Infinity Software. All Rights Reserved.</p>
           <Button asChild variant="secondary">
                <Link href="mailto:contact@infinitysoftware.com">Email Us For Your Needs</Link>
           </Button>
        </div>
      </footer>
    </div>
  );
}

    