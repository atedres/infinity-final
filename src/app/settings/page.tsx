"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, User, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';

export default function SettingsPage() {
    const { toast } = useToast();
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!auth) {
            router.push('/');
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
            } else {
                toast({ title: "Authentication Required", description: "Please log in to view settings.", variant: "destructive" });
                router.push('/');
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [router, toast]);

    const handlePasswordReset = async () => {
        if (!user || !user.email) {
            toast({ title: "Error", description: "User email not found.", variant: "destructive" });
            return;
        }
        if (!auth) return;
        try {
            await sendPasswordResetEmail(auth, user.email);
            toast({ title: "Password Reset Email Sent", description: "Check your inbox for a link to reset your password." });
        } catch (error) {
            console.error("Error sending password reset email:", error);
            toast({ title: "Error", description: "Could not send password reset email. Please try again later.", variant: "destructive" });
        }
    };

    const handleDeleteAccount = async () => {
        if (!user || !db) return;
        
        try {
            // First, delete Firestore document
            const userDocRef = doc(db, "users", user.uid);
            await deleteDoc(userDocRef);

            // Then, delete the Firebase Auth user
            await deleteUser(user);

            toast({ title: "Account Deleted", description: "Your account has been permanently deleted." });
            router.push('/');
        } catch (error: any) {
            console.error("Error deleting account:", error);
            let description = "Could not delete your account. Please try again.";
            if (error.code === 'auth/requires-recent-login') {
                description = "This action requires recent authentication. Please log out and log back in before deleting your account.";
            }
            toast({ title: "Error", description, variant: "destructive" });
        }
    };

    if (isLoading) {
        return <SubpageLayout title="Settings"><div className="text-center p-8">Loading settings...</div></SubpageLayout>;
    }

    return (
        <SubpageLayout title="Settings">
            <div className="space-y-8">
                <Card>
                    <CardHeader>
                        <CardTitle>Account Management</CardTitle>
                        <CardDescription>Manage your account settings and preferences.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div>
                                <h3 className="font-medium">Change Password</h3>
                                <p className="text-sm text-muted-foreground">Receive an email with a link to reset your password.</p>
                            </div>
                            <Button variant="outline" onClick={handlePasswordReset}>Send Reset Email</Button>
                        </div>
                        <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
                            <div>
                                <h3 className="font-medium text-destructive">Delete Account</h3>
                                <p className="text-sm text-muted-foreground">Permanently delete your account and all associated data. This action cannot be undone.</p>
                            </div>
                             <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive">Delete Account</Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This action cannot be undone. This will permanently delete your
                                            account and remove your data from our servers.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleDeleteAccount}>Continue</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Privacy</CardTitle>
                        <CardDescription>Manage your privacy settings.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div>
                                <h3 className="font-medium">Blocked Users</h3>
                                <p className="text-sm text-muted-foreground">Users you have blocked will not be able to interact with you.</p>
                            </div>
                             <Button variant="outline" disabled>View Blocked Users</Button>
                        </div>
                        <div className="text-center text-muted-foreground p-8">
                            <p>You haven't blocked any users yet.</p>
                        </div>
                    </CardContent>
                </Card>

            </div>
        </SubpageLayout>
    );
}
