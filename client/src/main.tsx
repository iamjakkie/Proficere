import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { LibraryPage } from "./pages/LibraryPage";
import { NewBookPage } from "./pages/NewBookPage";
import { BookPage } from "./pages/BookPage";
import { ReviewPage } from "./pages/ReviewPage";
import { ReadPage } from "./pages/ReadPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ArticlesPage } from "./pages/ArticlesPage";
import { ArticlePage } from "./pages/ArticlePage";
import { ArticleReadPage } from "./pages/ArticleReadPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CoursePage } from "./pages/CoursePage";
import { WorkshopPage } from "./pages/WorkshopPage";
import { WorkshopBoardPage } from "./pages/WorkshopBoardPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "library/new", element: <NewBookPage /> },
      { path: "books/:id", element: <BookPage /> },
      { path: "books/:id/read", element: <ReadPage /> },
      { path: "review/:chapterId", element: <ReviewPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "articles", element: <ArticlesPage /> },
      { path: "articles/:id", element: <ArticlePage /> },
      { path: "articles/:id/read", element: <ArticleReadPage /> },
      { path: "courses", element: <CoursesPage /> },
      { path: "courses/:id", element: <CoursePage /> },
      { path: "workshop", element: <WorkshopPage /> },
      { path: "workshop/:id", element: <WorkshopBoardPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
