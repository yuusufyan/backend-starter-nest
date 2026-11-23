import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_LIMIT,
  type ListQuery,
  type SortDirection,
} from '../database/list-query.js';

/** DTO query string untuk endpoint list; dipakai bersama `BaseRepository.findAll`. */
export class ListQueryDto implements ListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  term?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sortBy?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  orderBy?: SortDirection;
}
