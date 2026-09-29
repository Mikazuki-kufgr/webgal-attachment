/** Local console logging. No remote transport or runtime dependency. */
export class LocalLogger {
  private threshold = 0;
  private readonly levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

  setLevel(value: string): void {
    const name = value.toUpperCase();
    const index = name === 'ALL' ? 0 : name === 'NONE' ? this.levels.length : this.levels.indexOf(name);
    if (index < 0) throw new Error('Unknown log level: ' + value);
    this.threshold = index;
  }

  private write(level: string, message: unknown, data?: unknown): void {
    if (this.levels.indexOf(level) < this.threshold) return;
    const prefix = '[' + level + '] [' + new Date().toLocaleString() + ']';
    if (data === undefined) console.log(prefix, message);
    else console.log(prefix, message, data);
  }

  // The optional third parameter remains accepted for existing call compatibility.
  // Logging stays local regardless of its value.
  trace(message: unknown, data?: unknown, _legacyUpload?: boolean): void { this.write('TRACE', message, data); }
  debug(message: unknown, data?: unknown, _legacyUpload?: boolean): void { this.write('DEBUG', message, data); }
  info(message: unknown, data?: unknown, _legacyUpload?: boolean): void { this.write('INFO', message, data); }
  warn(message: unknown, data?: unknown, _legacyUpload?: boolean): void { this.write('WARN', message, data); }
  error(message: unknown, data?: unknown, _legacyUpload?: boolean): void { this.write('ERROR', message, data); }
  fatal(message: unknown, data?: unknown, _legacyUpload?: boolean): void { this.write('FATAL', message, data); }
}

export const logger = new LocalLogger();
