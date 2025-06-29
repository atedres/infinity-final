
"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  LogOut,
  User as UserIcon,
  Bell,
  Settings,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { doc, setDoc, getDoc, serverTimestamp, collection, query, where, onSnapshot, orderBy, getDocs, writeBatch } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import { formatDistanceToNow } from 'date-fns';
import { ThemeToggle } from './theme-toggle';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { cn } from '@/lib/utils';


interface Notification {
  id: string;
  actorName: string;
  type: 'follow' | 'like' | 'comment';
  entityId: string;
  read: boolean;
  createdAt: any;
  text: string;
  href: string;
  time: string;
}


export function HeaderActions() {
    const { toast } = useToast();
    const [user, setUser] = useState<User | null>(null);
    const [authAction, setAuthAction] = useState<'login' | 'signup' | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [role, setRole] = useState('');
    const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [hasUnread, setHasUnread] = useState(false);
    const playNotificationSound = useNotificationSound('/notification.mp3');
    const isInitialNotificationsLoad = useRef(true);

    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (!currentUser) {
                // Reset flag on logout
                isInitialNotificationsLoad.current = true;
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user || !db) {
            setNotifications([]);
            setHasUnread(false);
            return;
        }
        
        const q = query(collection(db, "notifications"), where("recipientId", "==", user.uid), orderBy("createdAt", "desc"));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            // Play sound only for new documents after the initial load
            if (!isInitialNotificationsLoad.current && snapshot.docChanges().some(change => change.type === 'added')) {
                playNotificationSound();
            }

            const fetchedNotifications = snapshot.docs.map(doc => {
                const data = doc.data();
                const id = doc.id;
                const createdAt = data.createdAt?.toDate();
                
                let text = '';
                let href = '#';
                
                switch (data.type) {
                    case 'like':
                        text = `${data.actorName} liked your post.`;
                        href = `/sound-sphere?tab=feed#post-${data.entityId}`;
                        break;
                    case 'comment':
                        text = `${data.actorName} commented on your post.`;
                        href = `/sound-sphere?tab=feed#post-${data.entityId}`;
                        break;
                    case 'follow':
                        text = `${data.actorName} started following you.`;
                        href = `/profile/${data.actorId}`;
                        break;
                    default:
                        text = 'You have a new notification.';
                }
                
                return {
                    id,
                    ...data,
                    text,
                    href,
                    time: createdAt ? formatDistanceToNow(createdAt, { addSuffix: true }) : 'just now'
                } as Notification;
            });
            
            setNotifications(fetchedNotifications);
            setHasUnread(fetchedNotifications.some(n => !n.read));
            
            // Mark initial load as complete
            if (isInitialNotificationsLoad.current) {
                isInitialNotificationsLoad.current = false;
            }
        });

        return () => unsubscribe();
    }, [user, playNotificationSound]);

    const handleOpenNotifications = async (open: boolean) => {
        // We now mark notifications as read when the dropdown is closed, not when opened.
        if (!open && hasUnread && db && user) {
            const unreadNotifsQuery = query(
                collection(db, "notifications"),
                where("recipientId", "==", user.uid),
                where("read", "==", false)
            );
            
            // It's a background task, so no need to block UI.
            // Let the onSnapshot listener handle the UI update.
            const unreadSnapshot = await getDocs(unreadNotifsQuery);
            if (!unreadSnapshot.empty) {
                const batch = writeBatch(db);
                unreadSnapshot.docs.forEach(doc => {
                    batch.update(doc.ref, { read: true });
                });
                await batch.commit();
            }
        }
    };


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
        <>
            <div className="flex items-center space-x-2">
                {user ? (
                <div className="flex items-center space-x-1">
                    <ThemeToggle />
                    <DropdownMenu onOpenChange={handleOpenNotifications}>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full">
                                <Bell className="h-5 w-5" />
                                {hasUnread && (
                                    <span className="absolute top-1 right-1 flex h-2 w-2">
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
                                    <DropdownMenuItem
                                        key={notification.id}
                                        asChild
                                        className={cn(
                                            'cursor-pointer !block',
                                            !notification.read && 'bg-secondary'
                                        )}
                                    >
                                        <Link href={notification.href} className="flex flex-col items-start gap-1 w-full">
                                            <p className="text-sm leading-tight whitespace-normal">{notification.text}</p>
                                            <p className="text-xs text-muted-foreground">{notification.time}</p>
                                        </Link>
                                    </DropdownMenuItem>
                                ))
                            ) : (
                                <DropdownMenuItem disabled>
                                    <p className="text-sm text-center w-full p-4">No new notifications</p>
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
                             <DropdownMenuItem asChild>
                                <Link href="/settings">
                                    <Settings className="mr-2 h-4 w-4" />
                                    <span>Settings</span>
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
                        <ThemeToggle />
                        <Button variant="ghost" onClick={() => handleAuthDialogOpen('login')}>
                            Login
                        </Button>
                        <Button onClick={() => handleAuthDialogOpen('signup')}>
                            Sign Up
                        </Button>
                    </div>
                )}
            </div>
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
        </>
    )
}
