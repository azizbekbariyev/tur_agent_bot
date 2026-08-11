export class Cash {
  id!: number;
  cash_number!: string;
  turist_count!: number;
  departure_date!: string;
  return_date!: string;
  created_at!: Date;
  updated_at!: Date;
  comment!: string;
  status!: string;
  additional_user_id?: number;
  user_id!: number;
  brutto?: {
    amount: string | number;
    currency: string;
    currency_amount: number;
  };
  moneys?: {
    type: string;
    money_received: string | number;
    currency: string;
    currency_amount: number;
  }[];
  passengers?: {
    first_name: string;
    last_name: string;
    phone_number?: string;
    created_at: Date;
  };
  cashServices?: {
    code?: string;
    service_amount: number;
    currency: string;
    currency_amount: number;
  }[];
  history?: {
    name: string;
    new_column: string;
    old_column: string;
    created_at: Date;
  }[];
}
