import axios, { AxiosError } from "axios";

const makeId = (length: number): string => {
  let result = "";
  const characters = "1234567890abcdefghijklmnopqrstuvwxyz";
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
};

export abstract class JsonRpcStingrayClient {
  constructor(protected apiUrl: string) {}

  protected async execRequest<T>({ method, params }: { method: string; params?: any }): Promise<T> {
    if (!this.apiUrl) {
      throw new Error(`apiUrl is required but not presented.`);
    }

    const messageId = makeId(10);

    let response = null;

    try {
      response = await axios //
        .post(
          this.apiUrl,
          {
            jsonrpc: "2.0",
            id: messageId,
            method,
            params: params ?? {},
          },
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
    } catch (error) {
      const errorBody: {
        method: string;
        messageId: string;
        status: number;
        response: {
          error: string;
          message: string;
        };
      } = {
        method,
        messageId,
        status: (error as AxiosError).response?.status ?? 0,
        response: {
          error: ((error as AxiosError).response?.data as any)?.error ?? "",
          message: ((error as AxiosError).response?.data as any)?.message ?? "",
        },
      };

      throw new Error(JSON.stringify(errorBody));
    }

    if (!response) {
      throw new Error("Empty response");
    }

    if (response.status !== 200) {
      throw new Error(JSON.stringify({ method, messageId, status: response.status }));
    }

    if (response.data?.error?.code) {
      throw new Error(JSON.stringify(response.data?.error));
    }

    return response.data.result as T;
  }
}
