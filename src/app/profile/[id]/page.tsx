"use client";

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  ReactCrop,
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

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


// Helper functions for image cropping
function canvasPreview(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  crop: PixelCrop,
) {
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('No 2d context')
  }
  
  const scaleX = image.naturalWidth / image.width
  const scaleY = image.naturalHeight / image.height
  const pixelRatio = window.devicePixelRatio
  
  canvas.width = Math.floor(crop.width * scaleX * pixelRatio)
  canvas.height = Math.floor(crop.height * scaleY * pixelRatio)

  ctx.scale(pixelRatio, pixelRatio)
  ctx.imageSmoothingQuality = 'high'

  const cropX = crop.x * scaleX
  const cropY = crop.y * scaleY
  
  const centerX = image.naturalWidth / 2
  const centerY = image.naturalHeight / 2

  ctx.save()
  ctx.translate(-cropX, -cropY)
  ctx.translate(centerX, centerY)
  ctx.translate(-centerX, -centerY)
  ctx.drawImage(
    image,
    0,
    0,
    image.naturalWidth,
    image.naturalHeight,
    0,
    0,
    image.naturalWidth,
    image.naturalHeight,
  )

  ctx.restore()
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

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
    const imgRef = useRef<HTMLImageElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
    const [followerCount, setFollowerCount] = useState(0);
    const [followingCount, setFollowingCount] = useState(0);
    const [isFollowing, setIsFollowing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isOwnProfile, setIsOwnProfile] = useState(false);

    // Crop State
    const [imgSrc, setImgSrc] = useState('');
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
    const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

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
        if (e.target.files && e.target.files.length > 0) {
            setCrop(undefined); // Reset crop
            const reader = new FileReader();
            reader.addEventListener('load', () =>
                setImgSrc(reader.result?.toString() || ''),
            );
            reader.readAsDataURL(e.target.files[0]);
            setIsCropDialogOpen(true);
            e.target.value = ''; // Allow re-selecting the same file
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

    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        const { width, height } = e.currentTarget;
        const crop = centerCrop(
            makeAspectCrop(
                {
                    unit: '%',
                    width: 90,
                },
                1,
                width,
                height,
            ),
            width,
            height,
        );
        setCrop(crop);
        setCompletedCrop(undefined);
    }
    
    const handleSaveCrop = async () => {
        const image = imgRef.current;
        const previewCanvas = previewCanvasRef.current;
        if (!image || !previewCanvas || !completedCrop) {
             toast({ title: 'Error', description: 'Cannot process crop.', variant: 'destructive' });
            return;
        }
        
        canvasPreview(image, previewCanvas, completedCrop);
        const blob = await toBlob(previewCanvas);
        
        if (!blob) {
            toast({ title: 'Error', description: 'Could not create cropped image.', variant: 'destructive' });
            return;
        }
        
        const file = new File([blob], `profile_${currentUser?.uid || Date.now()}.png`, { type: 'image/png' });

        await handlePictureUpload(file);
        setIsCropDialogOpen(false);
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
             <Dialog open={isCropDialogOpen} onOpenChange={setIsCropDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Crop your new picture</DialogTitle>
                        <DialogDescription>
                            Adjust the image to fit perfectly.
                        </DialogDescription>
                    </DialogHeader>
                    {imgSrc && (
                        <div className="flex justify-center">
                            <ReactCrop
                                crop={crop}
                                onChange={(_, percentCrop) => setCrop(percentCrop)}
                                onComplete={(c) => setCompletedCrop(c)}
                                aspect={1}
                                minWidth={100}
                                minHeight={100}
                                circularCrop
                            >
                                <img
                                    ref={imgRef}
                                    alt="Crop me"
                                    src={imgSrc}
                                    style={{ maxHeight: '70vh' }}
                                    onLoad={onImageLoad}
                                />
                            </ReactCrop>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCropDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveCrop} disabled={!completedCrop}>Save Picture</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {completedCrop && (
              <canvas
                ref={previewCanvasRef}
                style={{
                  display: 'none',
                  objectFit: 'contain',
                  width: completedCrop.width,
                  height: completedCrop.height,
                }}
              />
            )}

            <div className="flex flex-col items-center gap-8 md:flex-row md:items-start">
                <Card className="w-full md:w-1/3 text-center">
                    <CardContent className="p-6 flex flex-col items-center gap-4">
                        <div className="relative">
                            <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
                                <DialogTrigger asChild>
                                    <Avatar className="h-24 w-24 border-2 border-primary cursor-pointer hover:opacity-90 transition-opacity">
                                        <AvatarImage src={profileUser.photoURL || `https://placehold.co/96x96.png`} data-ai-hint="person portrait"/>
                                        <AvatarFallback className="text-3xl">{profileUser.firstName?.[0]}{profileUser.lastName?.[0]}</AvatarFallback>
                                    </Avatar>
                                </DialogTrigger>
                                <DialogContent className="max-w-md p-0 bg-transparent border-none shadow-none">
                                     <Image
                                        src={profileUser.photoURL || `https://placehold.co/512x512.png`}
                                        alt="Profile Picture"
                                        width={512}
                                        height={512}
                                        className="rounded-lg object-cover aspect-square"
                                        data-ai-hint="person portrait"
                                    />
                                </DialogContent>
                            </Dialog>
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
