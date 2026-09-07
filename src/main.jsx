import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installStorage } from "./storage";
import KanbanBoard from "./KanbanBoard";

installStorage();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <KanbanBoard />
  </StrictMode>
);
