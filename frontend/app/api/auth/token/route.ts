import { SignJWT } from "jose";
import { NextResponse } from "next/server";

export const runtime = "edge";

const SECRET = process.env.API_JWT_SECRET || "super-secret-finguard-key-change-in-prod";
const encodedSecret = new TextEncoder().encode(SECRET);

export async function GET() {
    try {
        // Generate a short-lived token (e.g., 5 minutes)
        const token = await new SignJWT({ sub: "finguard-frontend" })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(encodedSecret);

        return NextResponse.json({ token });
    } catch (error) {
        console.error("Token generation failed:", error);
        return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
    }
}
