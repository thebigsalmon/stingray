export interface Pagination {
  /** @description "Размер страниц" */
  pageSize: number;

  /** @description "Текущая страница" */
  pageNumber: number;
}

export interface Sort {
  /** @description "Поле для сортировки" */
  column: string;

  /** @description "Порядок сортировки ASC / DESC" */
  direction: string;
}
