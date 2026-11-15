import jwt from "jsonwebtoken";
import { env, type JwtPayload } from "@core/shared";

const EXPIRES_IN = "1h";

export const signAccessToken = (payload: JwtPayload) =>
    jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: EXPIRES_IN,
    });

export const verifyAccessToken = (token: string): JwtPayload =>
    jwt.verify(token, env.JWT_SECRET) as JwtPayload;