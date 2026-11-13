export enum OsType {
  Windows = 'win32',
  Linux = 'linux',
  Mac = 'darwin',
}

export const SUPPORTED_OS = ['windows', 'linux', 'mac'];

export function osTypeFromString(osName: string): OsType | undefined {
  const capitalized = osName[0].toUpperCase() + osName.slice(1).toLowerCase();
  return OsType[capitalized as keyof typeof OsType];
}

export function currentOs(): OsType {
  if (process.platform === 'win32') return OsType.Windows;
  if (process.platform === 'darwin') return OsType.Mac;
  return OsType.Linux;
}
