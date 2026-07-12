/** 
 * ipcRenderer.invoke wraps thrown errors as
 * "Error invoking remote method 'x': Error: <real message>" — unwrap it. 
 */
export function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}
