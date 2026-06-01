import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes Clerk auth state available throughout the app without blocking
// any routes — unauthenticated users can still access local mode.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
