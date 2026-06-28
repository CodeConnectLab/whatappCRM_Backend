import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env.js";
const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "WTSP API",
      version: "1.0.0",
      description: "Multi-tenant WhatsApp Marketing SaaS API"
    },
    servers: [{ url: `http://localhost:${env.PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    },
    security: [{ bearerAuth: [] }]
  },
  apis: ["./src/routes/**/*.ts", "./src/modules/**/*.ts", "./dist/routes/**/*.js", "./dist/modules/**/*.js"]
};
const swaggerSpec = swaggerJsdoc(options);
export {
  swaggerSpec
};
