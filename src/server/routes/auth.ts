// FILE: src/server/routes/auth.ts
import { Elysia } from "elysia";
import { userContext } from "../context";
import { loginRoute } from "./auth/login";
import { signupRoute } from "./auth/signup";
import { verifyRoute } from "./auth/verify";
import { passwordRoutes } from "./auth/password";
import { effectPlugin } from "../middleware/effect-plugin";

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(effectPlugin)
  .use(loginRoute)
  .use(signupRoute)
  .use(verifyRoute)
  .use(passwordRoutes)
  .use(userContext)
  .get("/me", ({ user, tenant, currentRole, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    return {
      user,
      tenant,      
      role: currentRole 
    };
  });
  // ✅ Removed /memberships
