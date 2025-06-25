import { Suspense } from 'react';
import { SubpageLayout } from "@/components/layout/subpage-layout";
import { Skeleton } from '@/components/ui/skeleton';
import SoundSphereClient from './client';

function SoundSpherePageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
      </div>
    </div>
  )
}

export default function SoundSpherePage() {
    return (
        <SubpageLayout title="Sound Sphere">
            <Suspense fallback={<SoundSpherePageSkeleton />}>
                <SoundSphereClient />
            </Suspense>
        </SubpageLayout>
    );
}
