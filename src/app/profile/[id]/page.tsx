"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { UserPlus, UserCheck } from 'lucide-react';

interface ProfileUser {
    uid: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    photoURL?: string;
}

export default function ProfilePage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const userId = params.id as string;

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
    const [followerCount, setFollowerCount] = useState(0);
    const [followingCount, setFollowingCount] = useState(0);
    const [isFollowing, setIsFollowing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, user => {
            setCurrentUser(user);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!userId || !db) return;

        const fetchProfileData = async () => {
            setIsLoading(true);
            try {
                const userDocRef = doc(db, "users", userId);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                    setProfileUser(userDocSnap.data() as ProfileUser);
                } else {
                    toast({ title: "Error", description: "User profile not found.", variant: "destructive" });
                    router.push('/sound-sphere');
                    return;
                }

                const followersQuery = collection(db, "users", userId, "followers");
                const followingQuery = collection(db, "users", userId, "following");
                
                const followersSnapshot = await getDocs(followersQuery);
                const followingSnapshot = await getDocs(followingQuery);

                setFollowerCount(followersSnapshot.size);
                setFollowingCount(followingSnapshot.size);
                
                if (currentUser) {
                    const followingDocRef = doc(db, "users", currentUser.uid, "following", userId);
                    const followingDocSnap = await getDoc(followingDocRef);
                    setIsFollowing(followingDocSnap.exists());
                }

            } catch (error) {
                console.error("Error fetching profile data:", error);
                toast({ title: "Error", description: "Could not load profile.", variant: "destructive" });
            } finally {
                setIsLoading(false);
            }
        };

        fetchProfileData();

    }, [userId, currentUser, router, toast]);

    const handleFollowToggle = async () => {
        if (!db || !currentUser || !profileUser || currentUser.uid === profileUser.uid) {
             toast({ title: "Login Required", description: "You must be logged in to follow users.", variant: "destructive" });
            return;
        }

        const followingRef = doc(db, "users", currentUser.uid, "following", profileUser.uid);
        const followerRef = doc(db, "users", profileUser.uid, "followers", currentUser.uid);

        try {
            if (isFollowing) {
                await deleteDoc(followingRef);
                await deleteDoc(followerRef);
                setIsFollowing(false);
                setFollowerCount(prev => prev - 1);
                toast({ title: "Unfollowed", description: `You are no longer following ${profileUser.firstName}.` });
            } else {
                await setDoc(followingRef, { since: serverTimestamp() });
                await setDoc(followerRef, { by: currentUser.displayName || 'Anonymous', at: serverTimestamp() });
                setIsFollowing(true);
                setFollowerCount(prev => prev + 1);
                toast({ title: "Followed", description: `You are now following ${profileUser.firstName}.` });
            }
        } catch (error) {
            console.error("Error following/unfollowing user:", error);
            toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
        }
    };
    
    if (isLoading) {
        return <SubpageLayout title="Profile"><div className="text-center p-8">Loading profile...</div></SubpageLayout>
    }

    if (!profileUser) {
        return <SubpageLayout title="Profile"><div className="text-center p-8">User not found.</div></SubpageLayout>
    }
    
    const displayName = `${profileUser.firstName} ${profileUser.lastName}`;

    return (
        <SubpageLayout title={`${displayName}'s Profile`}>
            <div className="flex flex-col items-center gap-8 md:flex-row md:items-start">
                <Card className="w-full md:w-1/3 text-center">
                    <CardContent className="p-6 flex flex-col items-center gap-4">
                        <Avatar className="h-24 w-24 border-2 border-primary">
                            <AvatarImage src={profileUser.photoURL || `https://placehold.co/96x96.png`} data-ai-hint="person portrait"/>
                            <AvatarFallback className="text-3xl">{profileUser.firstName?.[0]}{profileUser.lastName?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="space-y-1">
                             <h2 className="text-2xl font-bold">{displayName}</h2>
                             <p className="text-muted-foreground">@{profileUser.email?.split('@')[0]}</p>
                             <p className="text-sm text-foreground pt-2">{profileUser.role}</p>
                        </div>

                        <div className="flex justify-around w-full pt-4 border-t">
                            <div className="text-center">
                                <p className="font-bold text-xl">{followerCount}</p>
                                <p className="text-sm text-muted-foreground">Followers</p>
                            </div>
                            <div className="text-center">
                                <p className="font-bold text-xl">{followingCount}</p>
                                <p className="text-sm text-muted-foreground">Following</p>
                            </div>
                        </div>

                        {currentUser && currentUser.uid !== profileUser.uid && (
                             <Button className="w-full mt-4" onClick={handleFollowToggle} disabled={!currentUser}>
                                {isFollowing ? <UserCheck className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                {isFollowing ? 'Following' : 'Follow'}
                            </Button>
                        )}
                    </CardContent>
                </Card>
                <div className="w-full md:w-2/3">
                    <Card>
                        <CardHeader>
                            <CardTitle>Posts</CardTitle>
                            <CardDescription>Latest posts from {profileUser.firstName}.</CardDescription>
                        </CardHeader>
                        <CardContent>
                           <p className="text-muted-foreground text-center py-8">Post history will be shown here.</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </SubpageLayout>
    );
}
