import { z } from 'zod';
export function validateRequest(schemas) {
    return (req, res, next) => {
        try {
            if (schemas.body)
                req.body = schemas.body.parse(req.body);
            if (schemas.query)
                req.query = schemas.query.parse(req.query);
            if (schemas.params)
                req.params = schemas.params.parse(req.params);
            next();
        }
        catch (e) {
            next(e);
        }
    };
}
export const idParamSchema = z.object({
    id: z.string().regex(/^[a-f0-9]{24}$/i),
});
