import { createDocumentHandler, listDocumentsHandler } from "@/lib/documents/handlers";
import { documentsDeps } from "@/lib/documents/runtime";

export const GET = (req: Request) => listDocumentsHandler(documentsDeps(), req);
export const POST = (req: Request) => createDocumentHandler(documentsDeps(), req);
