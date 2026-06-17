declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  interface Database {
    run(sql: string, params?: any[] | Record<string, any>): Database;
    exec(sql: string, params?: any[] | Record<string, any>): QueryExecResult[];
    prepare(sql: string, params?: any[] | Record<string, any>): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
    create_function(name: string, func: (...args: any[]) => any): void;
    create_aggregate(
      name: string,
      step: (...args: any[]) => void,
      finalize: (...args: any[]) => any,
    ): void;
  }

  interface Statement {
    bind(params?: any[] | Record<string, any>): boolean;
    step(): boolean;
    getAsObject(params?: any[] | Record<string, any>): Record<string, any>;
    get(params?: any[] | Record<string, any>): any[];
    getColumnNames(): string[];
    free(): boolean;
    reset(): void;
  }

  export default function initSqlJs(config?: Record<string, any>): Promise<SqlJsStatic>;
  export { Database, SqlJsStatic, Statement, QueryExecResult };
}
