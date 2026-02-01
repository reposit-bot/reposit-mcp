export interface Solution {
  id: string;
  problem: string;
  solution: string;
  tags: string[];
  score: number;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  solutions: Solution[];
  total: number;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface DevicePollResponse {
  status: "pending" | "complete";
  token?: string;
}

export class RepositClient {
  constructor(
    private baseUrl: string,
    private token?: string
  ) {}

  async search(
    query: string,
    options: { tags?: string[]; limit?: number } = {}
  ): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query });
    if (options.tags?.length) {
      params.set("tags", options.tags.join(","));
    }
    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    const response = await this.request<{ data: SearchResult }>(
      `/api/v1/solutions/search?${params}`
    );
    return response.data;
  }

  async share(
    problem: string,
    solution: string,
    tags?: { language?: string[]; framework?: string[]; domain?: string[]; platform?: string[] }
  ): Promise<Solution> {
    const body = tags
      ? { problem, solution, tags }
      : { problem, solution };
    const response = await this.request<{ data: Solution }>(
      "/api/v1/solutions",
      { method: "POST", body: JSON.stringify(body) }
    );
    return response.data;
  }

  async upvote(id: string): Promise<{ message: string }> {
    const response = await this.request<{ data: { message: string } }>(
      `/api/v1/solutions/${id}/upvote`,
      { method: "POST" }
    );
    return response.data;
  }

  async downvote(
    id: string,
    reason: string,
    comment?: string
  ): Promise<{ message: string }> {
    const response = await this.request<{ data: { message: string } }>(
      `/api/v1/solutions/${id}/downvote`,
      {
        method: "POST",
        body: JSON.stringify({ reason, comment }),
      }
    );
    return response.data;
  }

  async startDeviceAuth(): Promise<DeviceCodeResponse> {
    const response = await this.request<{ data: DeviceCodeResponse }>(
      "/api/v1/auth/device",
      {
        method: "POST",
        body: JSON.stringify({ backend_url: this.baseUrl }),
      }
    );
    return response.data;
  }

  async pollDeviceAuth(deviceCode: string): Promise<DevicePollResponse> {
    const response = await this.request<{ data: DevicePollResponse }>(
      "/api/v1/auth/device/poll",
      {
        method: "POST",
        body: JSON.stringify({ device_code: deviceCode }),
      }
    );
    return response.data;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      let message = `HTTP ${response.status}`;
      try {
        const json = JSON.parse(body) as { error?: string; hint?: string };
        if (json.hint) message = json.hint;
        else if (json.error) message = json.error;
      } catch {
        if (body) message = body;
      }
      if (response.status === 401 && !message.includes("login")) {
        message = `${message}. Use the login tool to authenticate.`;
      }
      throw new Error(message);
    }

    return response.json();
  }
}
