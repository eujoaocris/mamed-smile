import { prisma } from '@/lib/prisma';
import { RequestContext } from './request-context';

export type LogType = 'ERROR' | 'INFO' | 'WARNING' | 'WHATSAPP' | 'DEBUG';

export interface LogParams {
    type: LogType;
    action: string;
    message: string;
    metadata?: Record<string, unknown>;
    userId?: string;
    role?: string;
    stack?: string;
    ipAddress?: string;
    userAgent?: string;
    duration?: number;
}

interface ConsoleLogConfig {
    color: string;
    method: 'log' | 'warn' | 'error';
}

const CONSOLE_BY_TYPE: Record<LogType, ConsoleLogConfig> = {
    INFO: { color: '\x1b[36m', method: 'log' },
    WARNING: { color: '\x1b[33m', method: 'warn' },
    ERROR: { color: '\x1b[31m', method: 'error' },
    WHATSAPP: { color: '\x1b[32m', method: 'log' },
    DEBUG: { color: '\x1b[90m', method: 'log' },
};

function normalizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
    const context = RequestContext.get();
    const requestId = RequestContext.getRequestId();
    const durationMs = RequestContext.getDurationMs();

    return {
        ...(metadata || {}),
        requestId: requestId || '',
        route: context?.route || undefined,
        role: context?.role || undefined,
        durationMs,
    };
}

function logToConsole(params: LogParams, metadata: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'production') return;

    const config = CONSOLE_BY_TYPE[params.type] || CONSOLE_BY_TYPE.INFO;
    const reset = '\x1b[0m';
    const timestamp = new Date().toISOString();
    const prefix = `${config.color}[${timestamp}] [${params.type}] [${params.action}]${reset}`;
    const writer = console[config.method];
    writer(`${prefix} ${params.message}`, metadata);

    if (params.stack) {
        console.error(params.stack);
    }
}

export async function logEvent(params: LogParams): Promise<void> {
    try {
        const context = RequestContext.get();
        const metadata = normalizeMetadata(params.metadata);
        const duration = params.duration ?? RequestContext.getDurationMs();
        const userId = params.userId || context?.userId || null;
        const role = params.role || context?.role || undefined;

        logToConsole(params, metadata);

        if (process.env.USE_MOCK_DB === 'true') return;

        await prisma.systemLog.create({
            data: {
                type: params.type,
                action: params.action,
                message: params.message,
                metadata: JSON.stringify({
                    ...metadata,
                    role,
                }),
                stack: params.stack || null,
                userId,
                ipAddress: params.ipAddress || null,
                userAgent: params.userAgent || null,
                duration,
            },
        });
    } catch (error) {
        if (process.env.USE_MOCK_DB !== 'true') {
            console.error('[LOGGER_CRITICAL] failed to persist structured log', error);
        }
    }
}

function normalizeErrorArgs(
    errorOrMetadata?: Error | Record<string, unknown>,
    metadata?: Record<string, unknown>
): { stack?: string; metadata?: Record<string, unknown> } {
    if (errorOrMetadata instanceof Error) {
        return {
            stack: errorOrMetadata.stack,
            metadata: {
                ...(metadata || {}),
                errorName: errorOrMetadata.name,
                errorMessage: errorOrMetadata.message,
            },
        };
    }

    if (errorOrMetadata && typeof errorOrMetadata === 'object') {
        return {
            metadata: {
                ...errorOrMetadata,
                ...(metadata || {}),
            },
        };
    }

    return { metadata };
}

const logger = {
    info(action: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
        return logEvent({ type: 'INFO', action, message, metadata });
    },

    warning(action: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
        return logEvent({ type: 'WARNING', action, message, metadata });
    },

    whatsapp(action: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
        return logEvent({ type: 'WHATSAPP', action, message, metadata });
    },

    debug(action: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
        return logEvent({ type: 'DEBUG', action, message, metadata });
    },

    error(
        action: string,
        message: string,
        errorOrMetadata?: Error | Record<string, unknown>,
        metadata?: Record<string, unknown>
    ): Promise<void> {
        const normalized = normalizeErrorArgs(errorOrMetadata, metadata);
        return logEvent({
            type: 'ERROR',
            action,
            message,
            stack: normalized.stack,
            metadata: normalized.metadata,
        });
    },
};

export function createContextLogger(context: Record<string, string>) {
    return {
        info(msg: string, data?: Record<string, unknown>): Promise<void> {
            return logEvent({ type: 'INFO', action: context.module || 'app', message: msg, metadata: { ...context, ...data } });
        },
        warn(msg: string, data?: Record<string, unknown>): Promise<void> {
            return logEvent({ type: 'WARNING', action: context.module || 'app', message: msg, metadata: { ...context, ...data } });
        },
        error(msg: string, data?: Record<string, unknown>): Promise<void> {
            return logEvent({ type: 'ERROR', action: context.module || 'app', message: msg, metadata: { ...context, ...data } });
        },
    };
}

export default logger;
