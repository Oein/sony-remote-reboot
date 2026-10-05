import { StyleSheet, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * MJPEG live view. React Native's Image can't play multipart/x-mixed-replace on iOS, but
 * WebKit's <img> can; the page retries whenever the stream ends (camera app paused, Wi-Fi hiccup).
 * {@code rotation} turns the (always landscape) frames upright when the camera is held sideways.
 */
export function LiveView({ url, rotation, style }: { url: string; rotation: number; style?: ViewStyle }) {
  const sideways = rotation === 90 || rotation === 270;
  // Sideways, the image is laid out with swapped dimensions and then turned into place
  const imageCss = sideways
    ? `position:absolute;top:50%;left:50%;width:100vh;height:100vw;transform:translate(-50%,-50%) rotate(${rotation}deg)`
    : `width:100%;height:100%;transform:rotate(${rotation}deg)`;
  const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
img{object-fit:contain;display:block;${imageCss}}</style></head>
<body><img id="v"><script>
var img=document.getElementById('v');
function connect(){img.src=${JSON.stringify(url)}+'?t='+Date.now();}
img.onerror=function(){setTimeout(connect,1000);};
connect();
</script></body></html>`;
  return (
    <View style={[styles.frame, style]}>
      <WebView
        key={`${url}#${rotation}`}
        originWhitelist={['*']}
        source={{ html, baseUrl: '' }}
        style={styles.web}
        scrollEnabled={false}
        bounces={false}
        allowsInlineMediaPlayback
        accessibilityLabel="라이브뷰"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#000', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#000' },
});
