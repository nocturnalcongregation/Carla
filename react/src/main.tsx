import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; // Ensure QueryClient is imported
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import App from "./App.tsx"; // App.tsx now includes QueryClientProvider
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
);
