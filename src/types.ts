export interface SaltIdsOptions {
  /**
   * Salt 长度 (默认为 4)
   */
  saltLength?: number;

  /**
   * Salt 字段后缀 (默认为 'Salt')
   * 例如: userId -> userSalt
   */
  saltSuffix?: string;
  
}
