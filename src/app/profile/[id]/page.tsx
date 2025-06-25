"use client";

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { db, auth, storage } from '@/lib/firebase';
import { onAuthStateChanged, User, updateProfile } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, setDoc, deleteDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { UserPlus, UserCheck, Edit, Camera } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';


interface ProfileUser {
    uid: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    photoURL?: string;
    bio?: string;
}

export default function ProfilePage() {
    const { toast } = useToast();
    const router = useRouter();
    const params = useParams();
    const userId = params.id as string;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
    const [followerCount, setFollowerCount] = useState(0);
    const [followingCount, setFollowingCount] = useState(0);
    const [isFollowing, setIsFollowing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isOwnProfile, setIsOwnProfile] = useState(false);

    // Edit Dialog State
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editedFirstName, setEditedFirstName] = useState('');
    const [editedLastName, setEditedLastName] = useState('');
    const [editedRole, setEditedRole] = useState('');
    const [editedBio, setEditedBio] = useState('');

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
                    const data = userDocSnap.data() as ProfileUser;
                    setProfileUser(data);
                    // Pre-fill edit form
                    setEditedFirstName(data.firstName);
                    setEditedLastName(data.lastName);
                    setEditedRole(data.role);
                    setEditedBio(data.bio || '');
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
                    setIsOwnProfile(currentUser.uid === userId);
                    const followingDocRef = doc(db, "users", currentUser.uid, "following", userId);
                    const followingDocSnap = await getDoc(followingDocRef);
                    setIsFollowing(followingDocSnap.exists());
                } else {
                    setIsOwnProfile(false);
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
    
    const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            handlePictureUpload(file);
        }
    };

    const handlePictureUpload = async (file: File) => {
        if (!storage) {
            toast({ title: 'Configuration Error', description: 'Firebase Storage is not configured correctly.', variant: 'destructive'});
            return;
        }
        if (!currentUser) {
            toast({ title: 'Authentication Error', description: 'You must be logged in to upload a picture.', variant: 'destructive'});
            return;
        }
        
        const filePath = `profile-pictures/${currentUser.uid}/${Date.now()}-${file.name}`;
        const fileRef = storageRef(storage, filePath);
        
        try {
            toast({ title: 'Uploading...', description: 'Your new profile picture is being uploaded.' });
            const uploadResult = await uploadBytes(fileRef, file);
            const photoURL = await getDownloadURL(uploadResult.ref);

            await updateProfile(currentUser, { photoURL });

            const userDocRef = doc(db, "users", currentUser.uid);
            await updateDoc(userDocRef, { photoURL });
            
            setProfileUser(prev => prev ? { ...prev, photoURL } : null);

            toast({ title: 'Success!', description: 'Profile picture updated.' });
        } catch (error: any) {
            console.error("Error uploading profile picture:", error);
            let description = 'Could not upload the new picture. Please try again.';
            if (error.code === 'storage/unauthorized') {
                description = "Upload failed. You don't have permission to write to this location. Please check your Firebase Storage security rules."
            } else if (error.code === 'storage/object-not-found') {
                description = "The file could not be found. Please try again."
            }
            toast({ title: 'Upload Failed', description, variant: 'destructive' });
        }
    };
    
    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser) return;
        
        const userDocRef = doc(db, "users", currentUser.uid);
        const newDisplayName = `${editedFirstName} ${editedLastName}`;

        try {
            await updateDoc(userDocRef, {
                firstName: editedFirstName,
                lastName: editedLastName,
                role: editedRole,
                bio: editedBio,
            });

            await updateProfile(currentUser, { displayName: newDisplayName });
            
            setProfileUser(prev => prev ? { 
                ...prev,
                firstName: editedFirstName,
                lastName: editedLastName,
                role: editedRole,
                bio: editedBio,
            } : null);
            
            setIsEditDialogOpen(false);
            toast({ title: 'Profile Updated', description: 'Your information has been saved.' });
        } catch (error) {
            console.error("Error updating profile:", error);
            toast({ title: 'Update Failed', description: 'Could not save your changes.', variant: 'destructive' });
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
                        <div className="relative">
                            <Avatar className="h-24 w-24 border-2 border-primary">
                                <AvatarImage src={profileUser.photoURL || `https://placehold.co/96x96.png`} data-ai-hint="person portrait"/>
                                <AvatarFallback className="text-3xl">{profileUser.firstName?.[0]}{profileUser.lastName?.[0]}</AvatarFallback>
                            </Avatar>
                            {isOwnProfile && (
                                <>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileSelect}
                                        className="hidden"
                                        accept="image/png, image/jpeg, image/gif"
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="absolute bottom-0 right-0 rounded-full h-8 w-8 bg-background"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Camera className="h-4 w-4" />
                                        <span className="sr-only">Change profile picture</span>
                                    </Button>
                                </>
                            )}
                        </div>
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

                        <div className="w-full">
                           {isOwnProfile ? (
                                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button className="w-full">
                                            <Edit className="mr-2 h-4 w-4" /> Edit Profile
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Edit Your Profile</DialogTitle>
                                            <DialogDescription>
                                                Make changes to your profile here. Click save when you're done.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form onSubmit={handleProfileUpdate} className="grid gap-4 py-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label htmlFor="firstName">First Name</Label>
                                                    <Input id="firstName" value={editedFirstName} onChange={(e) => setEditedFirstName(e.target.value)} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="lastName">Last Name</Label>
                                                    <Input id="lastName" value={editedLastName} onChange={(e) => setEditedLastName(e.target.value)} />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="role">Role</Label>
                                                <Input id="role" value={editedRole} onChange={(e) => setEditedRole(e.target.value)} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="bio">Bio</Label>
                                                <Textarea id="bio" placeholder="Tell us a bit about yourself..." value={editedBio} onChange={(e) => setEditedBio(e.target.value)} />
                                            </div>
                                            <DialogFooter>
                                                <Button type="submit">Save Changes</Button>
                                            </DialogFooter>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            ) : (
                                currentUser && (
                                    <Button className="w-full" onClick={handleFollowToggle} disabled={!currentUser}>
                                        {isFollowing ? <UserCheck className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                        {isFollowing ? 'Following' : 'Follow'}
                                    </Button>
                                )
                            )}
                        </div>
                    </CardContent>
                </Card>
                <div className="w-full md:w-2/3 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>About {profileUser.firstName}</CardTitle>
                        </CardHeader>
                        <CardContent>
                           <p className="text-muted-foreground">{profileUser.bio || "This user hasn't written a bio yet."}</p>
                        </CardContent>
                    </Card>
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

    